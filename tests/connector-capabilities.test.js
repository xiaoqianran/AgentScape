import { describe, expect, it, vi } from 'vitest';
import { ConnectorCapabilityAdapter } from '../src/connector/ConnectorCapabilityAdapter.js';
import { ConnectorContractError } from '../src/connector/ConnectorSession.js';
import { createDefaultProviderRegistry } from '../src/providers/ProviderRegistry.js';

const NOW=Date.parse('2026-08-24T06:30:00.000Z');
const SESSION={
  status:'paired',
  connector:{id:'unified-connector',instance:'instance_01',version:'1.0.0'},
  contractVersion:'1',
  capabilityRevision:'caprev_01',
  capabilityHash:'sha256:caprev_01'
};

const provider=(id='modal-2d',overrides={})=>({
  id,
  displayName:id,
  version:'1',
  implementationRevision:'impl-2026-08-24',
  health:'healthy',
  status:'available',
  contractVersion:'1',
  artifactTransport:'connector-artifact',
  capabilities:[{
    operation:`${id}.image.text_to_image.v1`,
    status:'available',
    category:'image-generation',
    input:{types:['text']},
    output:{roles:['image']},
    execution:{async:true,stages:['queued','running','artifact'],durationClass:'medium',costClass:'gpu'},
    prerequisites:{authMode:'provider-secret',connection:false,license:null},
    support:{cancel:true,resume:true,idempotency:true},
    artifactTransport:'connector-artifact'
  }],
  ...overrides
});

const snapshot=(overrides={})=>({
  contractVersion:'1',
  connector:{...SESSION.connector},
  revision:SESSION.capabilityRevision,
  hash:SESSION.capabilityHash,
  generatedAt:'2026-08-24T06:29:00.000Z',
  expiresAt:'2026-08-24T06:40:00.000Z',
  cachePolicy:{maxAgeSeconds:600},
  providers:[provider()],
  ...overrides
});

const response=(payload,status=200)=>({
  ok:status>=200&&status<300,
  status,
  json:async()=>structuredClone(payload)
});

describe('Connector capability discovery adapter',()=>{
  it('normalizes a paired snapshot and forces Connector-managed auth semantics',()=>{
    const adapter=new ConnectorCapabilityAdapter({now:()=>NOW});
    const result=adapter.normalizeSnapshot(snapshot({unknownEnvelopeField:'ignored'}),SESSION);
    expect(result).toMatchObject({
      sourceId:'connector:unified-connector',
      revision:'caprev_01',
      hash:'sha256:caprev_01',
      connector:SESSION.connector
    });
    expect(result).not.toHaveProperty('unknownEnvelopeField');
    expect(result.providers[0]).toMatchObject({
      id:'modal-2d',health:'healthy',status:'available',
      capabilities:[{
        operation:'modal-2d.image.text_to_image.v1',
        prerequisites:{authMode:'connector-session',connection:true}
      }]
    });
  });

  it('fetches capabilities through the scoped Connector request boundary',async()=>{
    const client={
      session:vi.fn(()=>structuredClone(SESSION)),
      request:vi.fn(async()=>response(snapshot()))
    };
    const adapter=new ConnectorCapabilityAdapter({now:()=>NOW});
    const result=await adapter.fetchSnapshot(client);
    expect(result.providers).toHaveLength(1);
    expect(client.request).toHaveBeenCalledWith('/connector/v1/capabilities',{scope:'capabilities.read'});
  });

  it('rejects revision, hash, connector and contract mismatches',()=>{
    const adapter=new ConnectorCapabilityAdapter({now:()=>NOW});
    expect(()=>adapter.normalizeSnapshot(snapshot({revision:'stale'}),SESSION))
      .toThrow(expect.objectContaining({code:'CONNECTOR_CAPABILITY_REVISION_MISMATCH'}));
    expect(()=>adapter.normalizeSnapshot(snapshot({hash:'sha256:other'}),SESSION))
      .toThrow(expect.objectContaining({code:'CONNECTOR_CAPABILITY_HASH_MISMATCH'}));
    expect(()=>adapter.normalizeSnapshot(snapshot({connector:{...SESSION.connector,instance:'instance_02'}}),SESSION))
      .toThrow(expect.objectContaining({code:'CONNECTOR_CAPABILITY_CONNECTOR_MISMATCH'}));
    expect(()=>adapter.normalizeSnapshot(snapshot({contractVersion:'2'}),SESSION))
      .toThrow(expect.objectContaining({code:'CONNECTOR_CONTRACT_MISMATCH'}));
  });

  it('rejects expired snapshots and requires a paired session',()=>{
    const adapter=new ConnectorCapabilityAdapter({now:()=>NOW});
    expect(()=>adapter.normalizeSnapshot(snapshot({expiresAt:'2026-08-24T06:29:59.000Z'}),SESSION))
      .toThrow(expect.objectContaining({code:'CONNECTOR_CAPABILITY_EXPIRED'}));
    expect(()=>adapter.normalizeSnapshot(snapshot(),{...SESSION,status:'expired'}))
      .toThrow(expect.objectContaining({code:'CONNECTION_REQUIRED'}));
  });

  it('fails closed on secret-like provider fields instead of retaining them as provenance',()=>{
    const adapter=new ConnectorCapabilityAdapter({now:()=>NOW});
    const payload=snapshot({providers:[provider('modal-2d',{providerPrivate:{apiKey:'should-never-cross'}})]});
    expect(()=>adapter.normalizeSnapshot(payload,SESSION))
      .toThrow(expect.objectContaining({code:'CONNECTOR_CAPABILITY_SECRET_FIELD'}));
  });

  it('tolerates unknown non-secret optional provider fields but strips them from canonical descriptors',()=>{
    const adapter=new ConnectorCapabilityAdapter({now:()=>NOW});
    const result=adapter.normalizeSnapshot(snapshot({providers:[provider('modal-2d',{providerPrivateApp:'modal-private-name'})]}),SESSION);
    expect(result.providers[0]).not.toHaveProperty('providerPrivateApp');
  });

  it('applies connector snapshots atomically and records provider provenance',()=>{
    const adapter=new ConnectorCapabilityAdapter({now:()=>NOW});
    const registry=createDefaultProviderRegistry();
    const normalized=adapter.normalizeSnapshot(snapshot(),SESSION);
    const state=adapter.applySnapshot(registry,normalized);
    expect(state).toMatchObject({sourceId:'connector:unified-connector',revision:'caprev_01',hash:'sha256:caprev_01'});
    expect(registry.getProvider('modal-2d')).toMatchObject({status:'available',health:'healthy'});
    expect(registry.getProviderSource('modal-2d')).toEqual({
      kind:'connector',sourceId:'connector:unified-connector',replaceableBy:[],
      connectorInstance:'instance_01',capabilityRevision:'caprev_01',capabilityHash:'sha256:caprev_01'
    });
  });

  it('clears dynamic providers when the paired Connector session is discarded',()=>{
    const adapter=new ConnectorCapabilityAdapter({now:()=>NOW});
    const registry=createDefaultProviderRegistry();
    adapter.applySnapshot(registry,adapter.normalizeSnapshot(snapshot(),SESSION));
    expect(registry.getProvider('modal-2d').status).toBe('available');
    const cleared=adapter.clearForSession(registry,SESSION);
    expect(cleared.cleared).toBe(true);
    expect(registry.getProvider('modal-2d').status).toBe('disabled');
  });

  it('does not make discovered capabilities executable without a later execution binding',()=>{
    const adapter=new ConnectorCapabilityAdapter({now:()=>NOW});
    const registry=createDefaultProviderRegistry();
    adapter.applySnapshot(registry,adapter.normalizeSnapshot(snapshot(),SESSION));
    expect(registry.findCapabilities({provider:'modal-2d',input:'text',output:'image',availableOnly:true})).toHaveLength(1);
    expect(registry.resolveCapability({provider:'modal-2d',input:'text',output:'image'})).toBeNull();
  });
});
