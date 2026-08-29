import { describe, expect, it } from 'vitest';
import { GenerationJobStore } from '../generation/jobs/GenerationJobStore.js';

const job=(id='job_01',overrides={})=>({
  id,provider:'modal-3d',operation:'modal-3d.asset.image_to_3d.v1',kind:'generation',
  requestHash:`sha256:${id}`,idempotencyKey:`idem_${id}`,contractVersion:'1',
  capabilityHash:'sha256:cap01',capabilityRevision:'caprev_01',
  status:'running',attempt:1,relations:[],effectiveOptions:{},
  createdAt:'2026-08-24T07:00:00.000Z',updatedAt:'2026-08-24T07:00:01.000Z',eventSequence:1,
  ...overrides
});

describe('GenerationJobStore atomic restart bootstrap',()=>{
  it('replaces the store atomically from a validated Connector snapshot',()=>{
    const store=new GenerationJobStore();
    store.apply(job('old_job'));
    const result=store.replaceAllAtomically([
      job('job_a',{status:'queued'}),
      job('job_b',{status:'succeeded',result:{artifacts:[]},completedAt:'2026-08-24T07:01:00.000Z'})
    ]);
    expect(result.map((item)=>item.id).sort()).toEqual(['job_a','job_b']);
    expect(store.get('old_job')).toBeNull();
    expect(store.get('job_b')).toMatchObject({status:'succeeded',phase:'result_available'});
  });

  it('keeps the previous store untouched when a later snapshot Job is malformed',()=>{
    const store=new GenerationJobStore();
    store.apply(job('stable_job'));
    expect(()=>store.replaceAllAtomically([
      job('job_a'),
      job('job_bad',{status:'provider_done'})
    ])).toThrow(expect.objectContaining({code:'JOB_STATUS_UNKNOWN'}));
    expect(store.list().map((item)=>item.id)).toEqual(['stable_job']);
  });

  it('rejects duplicate Job IDs before replacing existing state',()=>{
    const store=new GenerationJobStore();
    store.apply(job('stable_job'));
    expect(()=>store.replaceAllAtomically([job('dup'),job('dup',{eventSequence:2})]))
      .toThrow(expect.objectContaining({code:'JOB_SNAPSHOT_DUPLICATE_ID'}));
    expect(store.get('stable_job')).not.toBeNull();
  });

  it('rejects idempotency conflicts across different Jobs atomically',()=>{
    const store=new GenerationJobStore();
    expect(()=>store.replaceAllAtomically([
      job('job_a',{idempotencyKey:'same_key',requestHash:'sha256:a'}),
      job('job_b',{idempotencyKey:'same_key',requestHash:'sha256:b'})
    ])).toThrow(expect.objectContaining({code:'JOB_IDEMPOTENCY_CONFLICT'}));
    expect(store.list()).toEqual([]);
  });
});
