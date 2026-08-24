import {
  GenerationJobContractError,
  assertJobIdentityCompatible,
  assertJobTransition,
  jobFactSignature,
  normalizeGenerationJobProjection
} from './GenerationJobProjection.js';

const clone=(value)=>value == null ? value : structuredClone(value);

export class GenerationJobStore {
  constructor() {
    this.jobs=new Map();
    this.idempotency=new Map();
  }

  get(id) {
    const job=this.jobs.get(id);
    return job ? clone(job) : null;
  }

  list() {
    return [...this.jobs.values()].map(clone).sort((a,b)=>Date.parse(b.updatedAt)-Date.parse(a.updatedAt) || a.id.localeCompare(b.id));
  }

  apply(payload) {
    const next=normalizeGenerationJobProjection(payload);
    const idempotentOwner=this.idempotency.get(next.idempotencyKey);
    if (idempotentOwner && idempotentOwner.requestHash !== next.requestHash) {
      throw new GenerationJobContractError('JOB_IDEMPOTENCY_CONFLICT','Same idempotency key cannot represent a different request hash',{
        idempotencyKey:next.idempotencyKey,
        beforeRequestHash:idempotentOwner.requestHash,
        afterRequestHash:next.requestHash,
        beforeJobId:idempotentOwner.jobId,
        afterJobId:next.id
      });
    }
    if (idempotentOwner && idempotentOwner.jobId !== next.id) {
      throw new GenerationJobContractError('JOB_IDEMPOTENCY_CONFLICT','Same idempotency key cannot identify multiple Connector Jobs',{
        idempotencyKey:next.idempotencyKey,
        beforeJobId:idempotentOwner.jobId,
        afterJobId:next.id
      });
    }
    const previous=this.jobs.get(next.id);
    if (!previous) {
      this.jobs.set(next.id,next);
      this.idempotency.set(next.idempotencyKey,{requestHash:next.requestHash,jobId:next.id});
      return {state:'inserted',job:clone(next)};
    }
    assertJobIdentityCompatible(previous,next);
    if (next.lastEventSequence < previous.lastEventSequence) {
      return {state:'stale',job:clone(previous)};
    }
    if (next.lastEventSequence === previous.lastEventSequence) {
      if (jobFactSignature(next) !== jobFactSignature(previous)) {
        throw new GenerationJobContractError('JOB_EVENT_CONFLICT','Same Job event sequence contains conflicting facts',{
          id:next.id,sequence:next.lastEventSequence
        });
      }
      return {state:'idempotent',job:clone(previous)};
    }
    assertJobTransition(previous.status,next.status);
    this.jobs.set(next.id,next);
    return {state:'applied',job:clone(next)};
  }
}
