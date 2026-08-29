import { describe, expect, it, vi } from 'vitest';
import { ConnectorJobClient } from '../generation/connector/ConnectorJobClient.js';
import { normalizeConnectorJobEvent } from '../generation/connector/ConnectorJobEventClient.js';
import { GenerationJobStore } from '../generation/jobs/GenerationJobStore.js';
import {
  GenerationJobEventCursor,
  GenerationJobReconciler
} from '../generation/jobs/GenerationJobReconciler.js';
import { GenerationJobTransportOverlay } from '../generation/jobs/GenerationJobTransportOverlay.js';
import { createDefaultProviderRegistry } from '../generation/providers/ProviderRegistry.js';

const job=(status='running',sequence=1,overrides={})=>({
  id:'job_01',provider:'modal-3d',operation:'modal-3d.asset.image_to_3d.v1',kind:'generation',
  requestHash:'sha256:req01',idempotencyKey:'idem_01',contractVersion:'1',
  capabilityHash:'sha256:cap01',capabilityRevision:'caprev_01',status,attempt:1,relations:[],effectiveOptions:{},
  createdAt:'2026-08-24T07:00:00.000Z',updatedAt:new Date(Date.parse('2026-08-24T07:00:00.000Z')+sequence*1000).toISOString(),
  completedAt:['succeeded','failed','cancelled','expired'].includes(status) ? '2026-08-24T07:05:00.000Z' : null,
  eventSequence:sequence,
  ...overrides
});
const response=(payload,status=200)=>({ok:status>=200&&status<300,status,json:async()=>structuredClone(payload)});
const event=(sequence=10,overrides={})=>normalizeConnectorJobEvent({
  sequence,timestamp:'2026-08-24T07:10:00.000Z',jobId:'job_01',attempt:1,
  type:'job.updated',oldStatus:'queued',newStatus:'running',stage:'reconstructing',details:{},
  ...overrides
});

const makeClient=(request,store=new GenerationJobStore())=>new ConnectorJobClient({
  connectorClient:{request},providerRegistry:createDefaultProviderRegistry(),store
});

describe('Generation Job restart/reconcile',()=>{
  it('bootstraps the in-memory projection atomically from Connector list truth',async()=>{
    const store=new GenerationJobStore();
    store.apply(job('running',1,{id:'old_job',requestHash:'old',idempotencyKey:'old'}));
    const request=vi.fn(async()=>response({jobs:[
      job('running',2),
      job('succeeded',4,{id:'job_02',requestHash:'sha256:req02',idempotencyKey:'idem_02',result:{artifacts:[]}})
    ],eventCursor:17}));
    const jobClient=makeClient(request,store);
    const reconciler=new GenerationJobReconciler({jobClient});
    const result=await reconciler.bootstrap();
    expect(result.state).toBe('ready');
    expect(result.eventCursor).toBe(17);
    expect(jobClient.listCached().map((item)=>item.id).sort()).toEqual(['job_01','job_02']);
    expect(jobClient.getCached('old_job')).toBeNull();
    expect(reconciler.cursor.sequence).toBe(17);
    expect(request).toHaveBeenCalledWith('/connector/v1/jobs',{scope:'jobs.read'});
  });

  it('does not partially replace the store when restart list contains a malformed later Job',async()=>{
    const store=new GenerationJobStore();
    store.apply(job('running',1,{id:'stable_job',requestHash:'stable',idempotencyKey:'stable'}));
    const jobClient=makeClient(vi.fn(async()=>response({jobs:[job('running',2),job('provider_done',3,{id:'bad_job'})]})),store);
    const reconciler=new GenerationJobReconciler({jobClient});
    await expect(reconciler.bootstrap()).rejects.toMatchObject({code:'JOB_STATUS_UNKNOWN'});
    expect(jobClient.listCached().map((item)=>item.id)).toEqual(['stable_job']);
  });

  it('marks local transport recovery without fabricating a remote Job status or sequence',async()=>{
    const store=new GenerationJobStore();
    store.apply(job('running',5));
    const request=vi.fn(async()=>{ const error=new Error('connector offline'); error.code='CONNECTION_REQUIRED'; throw error; });
    const overlay=new GenerationJobTransportOverlay({now:()=>Date.parse('2026-08-24T07:20:00.000Z')});
    const jobClient=makeClient(request,store);
    const reconciler=new GenerationJobReconciler({jobClient,overlay});
    const result=await reconciler.reconcileJob('job_01');
    expect(result.state).toBe('connection_required');
    expect(result.view.effectivePhase).toBe('recoverable');
    expect(result.job).toMatchObject({status:'running',lastEventSequence:5});
    expect(jobClient.getCached('job_01')).toMatchObject({status:'running',lastEventSequence:5});
    expect(overlay.get('job_01')).toMatchObject({state:'connection_required'});
  });

  it('sanitizes unsafe transport error messages without changing canonical Job truth',async()=>{
    const store=new GenerationJobStore();
    store.apply(job('running',5));
    const request=vi.fn(async()=>{ const error=new Error('https://internal.example?token=x'); error.code='CONNECTION_REQUIRED'; throw error; });
    const overlay=new GenerationJobTransportOverlay();
    const jobClient=makeClient(request,store);
    const reconciler=new GenerationJobReconciler({jobClient,overlay});
    await reconciler.reconcileJob('job_01');
    expect(overlay.get('job_01').message).toBe('Connector is not reachable');
    expect(jobClient.getCached('job_01')).toMatchObject({status:'running',lastEventSequence:5});
  });

  it('clears the transport overlay after a successful reconnect/reconcile',async()=>{
    const store=new GenerationJobStore();
    store.apply(job('running',5));
    const overlay=new GenerationJobTransportOverlay();
    overlay.markConnectionRequired('job_01');
    const jobClient=makeClient(vi.fn(async()=>response({job:job('running',6)})),store);
    const reconciler=new GenerationJobReconciler({jobClient,overlay});
    const result=await reconciler.reconcileJob('job_01');
    expect(result.state).toBe('reconciled');
    expect(result.job.lastEventSequence).toBe(6);
    expect(overlay.get('job_01')).toBeNull();
  });

  it('reconciles only remote-nonterminal Jobs during finite poll fallback',async()=>{
    const store=new GenerationJobStore();
    store.apply(job('running',1));
    store.apply(job('succeeded',2,{id:'job_done',requestHash:'done',idempotencyKey:'done',result:{artifacts:[]}}));
    const request=vi.fn(async(path)=>{
      expect(path).toBe('/connector/v1/jobs/job_01');
      return response({job:job('running',2)});
    });
    const jobClient=makeClient(request,store);
    const reconciler=new GenerationJobReconciler({jobClient});
    const result=await reconciler.reconcileActive();
    expect(result).toHaveLength(1);
    expect(request).toHaveBeenCalledTimes(1);
  });
});

describe('Generation Job global event cursor',()=>{
  it('applies monotonic notification only after canonical Job GET succeeds',async()=>{
    const store=new GenerationJobStore();
    store.apply(job('running',1));
    const request=vi.fn(async()=>response({job:job('running',2)}));
    const jobClient=makeClient(request,store);
    const cursor=new GenerationJobEventCursor();
    const reconciler=new GenerationJobReconciler({jobClient,cursor});
    const evt=event(10);
    const result=await reconciler.handleEvent(evt);
    expect(result.state).toBe('applied');
    expect(cursor.sequence).toBe(10);
    expect(jobClient.getCached('job_01').lastEventSequence).toBe(2);

    expect((await reconciler.handleEvent(evt)).state).toBe('idempotent');
    expect((await reconciler.handleEvent(event(9))).state).toBe('stale');
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('revalidates event envelopes at the reconciler boundary before any Job GET',async()=>{
    const store=new GenerationJobStore();
    store.apply(job('running',1));
    const request=vi.fn();
    const jobClient=makeClient(request,store);
    const reconciler=new GenerationJobReconciler({jobClient});
    await expect(reconciler.handleEvent({...event(10),details:{signedUrl:'https://bad.example'}}))
      .rejects.toMatchObject({code:'CONNECTOR_JOB_EVENT_UNSAFE'});
    expect(request).not.toHaveBeenCalled();
    expect(reconciler.cursor.sequence).toBeNull();
  });

  it('rejects same global sequence with a conflicting event envelope',async()=>{
    const store=new GenerationJobStore();
    store.apply(job('running',1));
    const jobClient=makeClient(vi.fn(async()=>response({job:job('running',2)})),store);
    const reconciler=new GenerationJobReconciler({jobClient});
    await reconciler.handleEvent(event(10));
    await expect(reconciler.handleEvent(event(10,{type:'job.progress'})))
      .rejects.toMatchObject({code:'CONNECTOR_JOB_EVENT_CONFLICT'});
  });

  it('does not advance the global cursor when canonical reconciliation is blocked by transport',async()=>{
    const store=new GenerationJobStore();
    store.apply(job('running',1));
    const request=vi.fn(async()=>{ const error=new Error('offline'); error.code='CONNECTION_REQUIRED'; throw error; });
    const jobClient=makeClient(request,store);
    const reconciler=new GenerationJobReconciler({jobClient});
    const result=await reconciler.handleEvent(event(10));
    expect(result.state).toBe('connection_required');
    expect(reconciler.cursor.sequence).toBeNull();
    expect(jobClient.getCached('job_01').lastEventSequence).toBe(1);
  });
});
