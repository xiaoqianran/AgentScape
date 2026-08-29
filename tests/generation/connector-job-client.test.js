import { describe, expect, it, vi } from 'vitest';
import { ConnectorJobClient } from '../../generation/connector/ConnectorJobClient.js';
import { createProviderRegistry } from '../../generation/providers/ProviderRegistry.js';

const CAP_SOURCE='connector:unified-connector';
const operation='modal-3d.asset.image_to_3d.v1';

const dynamicProvider={
  id:'modal-3d',version:'1',status:'available',health:'healthy',contractVersion:'1',
  capabilities:[{
    operation,version:'1',status:'available',category:'asset-generation',
    input:{types:['image']},output:{roles:['asset']},
    execution:{async:true},
    prerequisites:{authMode:'connector-session',connection:true},
    support:{cancel:true,resume:true,idempotency:true}
  }]
};

const registry=()=>{
  const r=createProviderRegistry();
  r.applyProviderSnapshot({
    revision:'caprev_01',hash:'sha256:cap01',
    connector:{id:'unified-connector',instance:'instance_01',version:'1.0.0'},
    providers:[dynamicProvider]
  },{sourceId:CAP_SOURCE,sourceKind:'connector'});
  return r;
};

const job=(status='accepted',sequence=1,overrides={})=>({
  id:'job_01',provider:'modal-3d',operation,kind:'generation',
  requestHash:'sha256:req01',idempotencyKey:'idem_01',contractVersion:'1',
  capabilityHash:'sha256:cap01',capabilityRevision:'caprev_01',
  status,attempt:1,relations:[],effectiveOptions:{profile:'standard'},
  createdAt:'2026-08-24T06:00:00.000Z',updatedAt:'2026-08-24T06:00:01.000Z',
  eventSequence:sequence,
  ...overrides
});

const response=(payload,status=200)=>({
  ok:status>=200&&status<300,status,
  json:async()=>structuredClone(payload)
});

const submitRequest=()=>({
  provider:'modal-3d',operation,
  idempotencyKey:'idem_01',requestHash:'sha256:req01',
  inputs:{image:{artifactId:'source_image'}},
  profile:'standard',options:{quality:'balanced'},outputRoles:['asset'],
  metadata:{source:'agentscape'}
});

describe('ConnectorJobClient',()=>{
  it('submits through jobs.submit with capability revision/hash provenance',async()=>{
    const connectorClient={request:vi.fn(async()=>response({job:job()}))};
    const client=new ConnectorJobClient({connectorClient,providerRegistry:registry()});
    const result=await client.submit(submitRequest());
    expect(result).toMatchObject({id:'job_01',status:'accepted',phase:'pending'});
    const [path,options]=connectorClient.request.mock.calls[0];
    expect(path).toBe('/connector/v1/jobs');
    expect(options).toMatchObject({scope:'jobs.submit',method:'POST'});
    const body=JSON.parse(options.body);
    expect(body).toMatchObject({
      provider:'modal-3d',operation,operationVersion:'1',contractVersion:'1',
      idempotencyKey:'idem_01',requestHash:'sha256:req01',
      capabilityHash:'sha256:cap01',capabilityRevision:'caprev_01'
    });
    expect(body).not.toHaveProperty('token');
  });

  it('uses jobs.read and jobs.cancel scopes and preserves cancel_requested as nonterminal',async()=>{
    const connectorClient={request:vi.fn()
      .mockImplementationOnce(async()=>response({job:job('running',2)}))
      .mockImplementationOnce(async()=>response({job:job('cancel_requested',3)}))
    };
    const client=new ConnectorJobClient({connectorClient,providerRegistry:registry()});
    const read=await client.get('job_01');
    expect(read.phase).toBe('pending');
    const cancelling=await client.cancel('job_01');
    expect(cancelling).toMatchObject({status:'cancel_requested',phase:'cancelling'});
    expect(connectorClient.request.mock.calls[0][0]).toBe('/connector/v1/jobs/job_01');
    expect(connectorClient.request.mock.calls[0][1]).toEqual({scope:'jobs.read'});
    expect(connectorClient.request.mock.calls[1][0]).toBe('/connector/v1/jobs/job_01/cancel');
    expect(connectorClient.request.mock.calls[1][1]).toMatchObject({scope:'jobs.cancel',method:'POST'});
  });

  it('rejects unsafe Job IDs before issuing Connector requests',async()=>{
    const connectorClient={request:vi.fn()};
    const client=new ConnectorJobClient({connectorClient,providerRegistry:registry()});
    await expect(client.get('../secret')).rejects.toMatchObject({code:'JOB_ID_INVALID'});
    await expect(client.cancel('job/child')).rejects.toMatchObject({code:'JOB_ID_INVALID'});
    expect(connectorClient.request).not.toHaveBeenCalled();
  });

  it('rejects submit when capability is only static/disabled or lacks Connector provenance',async()=>{
    const connectorClient={request:vi.fn()};
    const client=new ConnectorJobClient({connectorClient,providerRegistry:createProviderRegistry()});
    await expect(client.submit(submitRequest())).rejects.toMatchObject({code:'JOB_CAPABILITY_UNAVAILABLE'});
    expect(connectorClient.request).not.toHaveBeenCalled();
  });

  it('rejects a submit response using a different provider contract version',async()=>{
    const connectorClient={request:vi.fn(async()=>response({job:job('accepted',1,{contractVersion:'2'})}))};
    const client=new ConnectorJobClient({connectorClient,providerRegistry:registry()});
    await expect(client.submit(submitRequest())).rejects.toMatchObject({code:'JOB_RESPONSE_IDENTITY_MISMATCH'});
    expect(client.listCached()).toEqual([]);
  });

  it('rejects output roles that the discovered capability did not declare',async()=>{
    const connectorClient={request:vi.fn()};
    const client=new ConnectorJobClient({connectorClient,providerRegistry:registry()});
    await expect(client.submit({...submitRequest(),outputRoles:['asset','provider-debug-log']}))
      .rejects.toMatchObject({code:'JOB_OUTPUT_ROLE_INVALID'});
    expect(connectorClient.request).not.toHaveBeenCalled();
  });

  it('rejects GET/CANCEL responses for a different Job ID before caching them',async()=>{
    const connectorClient={request:vi.fn()
      .mockImplementationOnce(async()=>response({job:job('running',2,{id:'job_other'})}))
      .mockImplementationOnce(async()=>response({job:job('cancel_requested',3,{id:'job_other'})}))
    };
    const client=new ConnectorJobClient({connectorClient,providerRegistry:registry()});
    await expect(client.get('job_01')).rejects.toMatchObject({code:'JOB_RESPONSE_IDENTITY_MISMATCH'});
    await expect(client.cancel('job_01')).rejects.toMatchObject({code:'JOB_RESPONSE_IDENTITY_MISMATCH'});
    expect(client.listCached()).toEqual([]);
  });

  it('rejects response identity mismatch instead of caching an unrelated Connector Job',async()=>{
    const connectorClient={request:vi.fn(async()=>response({job:job('accepted',1,{requestHash:'sha256:other'})}))};
    const client=new ConnectorJobClient({connectorClient,providerRegistry:registry()});
    await expect(client.submit(submitRequest())).rejects.toMatchObject({code:'JOB_RESPONSE_IDENTITY_MISMATCH'});
    expect(client.listCached()).toEqual([]);
  });

  it('rejects secret-like submit metadata/options before transport',async()=>{
    const connectorClient={request:vi.fn()};
    const client=new ConnectorJobClient({connectorClient,providerRegistry:registry()});
    await expect(client.submit({...submitRequest(),metadata:{apiKey:'must-not-cross'}}))
      .rejects.toMatchObject({code:'JOB_SECRET_FIELD'});
    expect(connectorClient.request).not.toHaveBeenCalled();
  });
});
