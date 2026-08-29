import { describe, expect, it } from 'vitest';
import { GenerationJobStore } from '../generation/jobs/GenerationJobStore.js';

const event=(status='accepted',sequence=1,overrides={})=>({
  id:'job_01',provider:'modal-3d',operation:'modal-3d.asset.image_to_3d.v1',kind:'generation',
  requestHash:'sha256:req01',idempotencyKey:'idem_01',contractVersion:'1',
  capabilityHash:'sha256:cap01',capabilityRevision:'caprev_01',
  status,stage:null,progress:null,attempt:1,relations:[],effectiveOptions:{},
  createdAt:'2026-08-24T06:00:00.000Z',
  updatedAt:new Date(Date.parse('2026-08-24T06:00:00.000Z')+sequence*1000).toISOString(),
  completedAt:['succeeded','failed','cancelled','expired'].includes(status)
    ? new Date(Date.parse('2026-08-24T06:00:00.000Z')+sequence*1000).toISOString() : null,
  eventSequence:sequence,
  ...overrides
});

describe('Generation Job event store',()=>{
  it('applies monotonic events and ignores stale observations',()=>{
    const store=new GenerationJobStore();
    expect(store.apply(event('accepted',1)).state).toBe('inserted');
    expect(store.apply(event('running',3)).state).toBe('applied');
    const stale=store.apply(event('queued',2));
    expect(stale.state).toBe('stale');
    expect(stale.job.status).toBe('running');
    expect(store.get('job_01').lastEventSequence).toBe(3);
  });

  it('accepts exact duplicate events but rejects same-sequence conflicting facts',()=>{
    const store=new GenerationJobStore();
    const running=event('running',3,{stage:'reconstructing'});
    store.apply(running);
    expect(store.apply(structuredClone(running)).state).toBe('idempotent');
    expect(()=>store.apply(event('running',3,{stage:'texturing'})))
      .toThrow(expect.objectContaining({code:'JOB_EVENT_CONFLICT'}));
  });

  it('allows cancel_requested to race to succeeded and maps it to result_available',()=>{
    const store=new GenerationJobStore();
    store.apply(event('running',1));
    store.apply(event('cancel_requested',2));
    const result=store.apply(event('succeeded',3,{result:{artifacts:[]}}));
    expect(result.state).toBe('applied');
    expect(result.job).toMatchObject({status:'succeeded',phase:'result_available'});
  });

  it('keeps connection_required recoverable and permits later observed progress',()=>{
    const store=new GenerationJobStore();
    store.apply(event('running',1));
    expect(store.apply(event('connection_required',2)).job.phase).toBe('recoverable');
    expect(store.apply(event('running',3)).job.phase).toBe('pending');
  });

  it('rejects regression from an authoritative Connector terminal fact',()=>{
    const store=new GenerationJobStore();
    store.apply(event('succeeded',5,{result:{artifacts:[]}}));
    expect(()=>store.apply(event('running',6)))
      .toThrow(expect.objectContaining({code:'JOB_STATUS_REGRESSION'}));
  });

  it('rejects immutable identity changes across observations',()=>{
    const store=new GenerationJobStore();
    store.apply(event('running',1));
    expect(()=>store.apply(event('running',2,{capabilityHash:'sha256:different'})))
      .toThrow(expect.objectContaining({code:'JOB_IDENTITY_CONFLICT'}));
  });

  it('enforces idempotency key -> request hash -> Job identity consistency',()=>{
    const store=new GenerationJobStore();
    store.apply(event('accepted',1));
    expect(()=>store.apply(event('accepted',1,{id:'job_02',requestHash:'sha256:other'})))
      .toThrow(expect.objectContaining({code:'JOB_IDEMPOTENCY_CONFLICT'}));
    expect(()=>store.apply(event('accepted',1,{id:'job_02'})))
      .toThrow(expect.objectContaining({code:'JOB_IDEMPOTENCY_CONFLICT'}));
  });
});
