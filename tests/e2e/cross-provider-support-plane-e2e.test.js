import { describe, expect, it, vi } from 'vitest';
import { ConnectorCapabilityAdapter } from '../../generation/connector/ConnectorCapabilityAdapter.js';
import { createProviderRegistry } from '../../generation/providers/ProviderRegistry.js';

const NOW=Date.parse('2026-08-27T00:00:00.000Z');
const SESSION={
  status:'paired',contractVersion:'1',
  connector:{id:'unified-connector',instance:'instance_cross_provider',version:'1.0.0'},
  capabilityRevision:'rev-cross-provider',capabilityHash:'sha256:cross-provider'
};

const capability=(operation,input,output)=>({
  operation,status:'available',category:'generation',
  input:{types:input},output:{roles:output},
  execution:{async:true,stages:['queued','running','artifact'],durationClass:'long',costClass:'gpu'},
  support:{cancel:true,resume:true,idempotency:true},artifactTransport:'connector-artifact'
});

const payload={
  contractVersion:'1',connector:SESSION.connector,revision:SESSION.capabilityRevision,hash:SESSION.capabilityHash,
  generatedAt:'2026-08-27T00:00:00.000Z',expiresAt:'2026-08-28T00:00:00.000Z',
  providers:[
    {id:'modal-2d',version:'1',status:'available',health:'healthy',artifactTransport:'connector-artifact',capabilities:[
      capability('modal-2d.image.text_to_image.v1',['text'],['image'])
    ]},
    {id:'modal-3d',version:'1',status:'available',health:'healthy',artifactTransport:'connector-artifact',capabilities:[
      capability('modal-3d.asset.image_to_3d.v1',['image','rgba'],['asset'])
    ]},
    {id:'embodiedgen',version:'1',status:'available',health:'healthy',artifactTransport:'connector-artifact',capabilities:[
      capability('embodiedgen.asset.text_to_3d.v1',['text'],['asset'])
    ]}
  ]
};

describe('cross-provider support-plane E2E',()=>{
  it('converges Modal 2D, Modal 3D and EmbodiedGen on one Connector snapshot and one registry',async()=>{
    const registry=createProviderRegistry();
    const adapter=new ConnectorCapabilityAdapter({now:()=>NOW});
    const snapshot=adapter.normalizeSnapshot(payload,SESSION);
    const state=adapter.applySnapshot(registry,snapshot);

    expect(state.providerIds.sort()).toEqual(['embodiedgen','modal-2d','modal-3d']);
    for(const id of state.providerIds){
      expect(registry.getProvider(id)).toMatchObject({status:'available',health:'healthy',artifactTransport:'connector-artifact'});
      expect(registry.getProviderSource(id)).toMatchObject({kind:'connector',sourceId:'connector:unified-connector',connectorInstance:'instance_cross_provider'});
    }

    const calls=[];
    for(const op of ['modal-2d.image.text_to_image.v1','modal-3d.asset.image_to_3d.v1','embodiedgen.asset.text_to_3d.v1']){
      registry.bindCapability(op,{execute:vi.fn(async(request,cap)=>{calls.push([cap.provider,request]);return {provider:cap.provider,request};})});
    }
    await expect(registry.execute('modal-2d.image.text_to_image.v1',{prompt:'chair'})).resolves.toMatchObject({provider:'modal-2d'});
    await expect(registry.execute('modal-3d.asset.image_to_3d.v1',{artifactId:'image_01'})).resolves.toMatchObject({provider:'modal-3d'});
    await expect(registry.execute('embodiedgen.asset.text_to_3d.v1',{prompt:'robot arm'})).resolves.toMatchObject({provider:'embodiedgen'});
    expect(calls.map(([provider])=>provider)).toEqual(['modal-2d','modal-3d','embodiedgen']);

    adapter.clearForSession(registry,SESSION);
    expect(registry.getProvider('modal-2d')).toBeNull();
    expect(registry.getProvider('modal-3d')).toBeNull();
    expect(registry.getProvider('embodiedgen')).toBeNull();
  });
});
