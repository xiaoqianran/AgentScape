import { createCanonicalWorldPipeline } from '../compiler/createWorldPipeline.js';
import { buildWorldRetryPlan } from '../compiler/WorldRetry.js';
import { recompileWorldRevision } from '../compiler/WorldRecompiler.js';

export class WorldBuilder {
  constructor(runtime, { pipeline = null, retryBudget = 2 } = {}) {
    if (!runtime) throw new TypeError('WorldBuilder requires a runtime');
    if (!Number.isInteger(retryBudget) || retryBudget < 1) throw new TypeError('WorldBuilder retryBudget must be a positive integer');
    this.runtime = runtime;
    this.pipeline = pipeline || createCanonicalWorldPipeline(runtime);
    this.retryBudget = retryBudget;
  }

  async run(plan) {
    const runtime = this.runtime;
    const before = runtime.snapshot();
    const authorityBefore = runtime.captureWorldAuthority?.() || null;
    const attempts = [];
    let candidate = plan;

    const restoreBefore = async (cause = null) => {
      try {
        await runtime.restore(before);
        if (authorityBefore) runtime.restoreWorldAuthority?.(authorityBefore);
        else runtime.loadRuleGraph?.(runtime.currentBehaviorBundle?.ruleGraph || []);
      } catch (rollbackError) {
        const failure = new AggregateError(
          cause ? [cause, rollbackError] : [rollbackError],
          'World build rollback failed',
          cause ? { cause } : undefined
        );
        failure.code = 'WORLD_BUILD_ROLLBACK_FAILED';
        failure.rollbackError = rollbackError;
        throw failure;
      }
    };

    const runCandidate = async (candidatePlan) => {
      try {
        runtime.loadRuleGraph?.([]);
        await runtime.clearObjects({ silent:true });
        return await this.pipeline.run(candidatePlan);
      } catch (error) {
        await restoreBefore(error);
        throw error;
      }
    };

    for (let attempt = 1; attempt <= this.retryBudget; attempt++) {
      const pipeline = await runCandidate(candidate);
      const admission = pipeline.state?.reports?.worldAdmission;
      if (!admission) {
        const error = new Error('Canonical world pipeline produced no world admission');
        error.code = 'WORLD_PIPELINE_ADMISSION_MISSING';
        await restoreBefore(error);
        throw error;
      }

      const record = { attempt, admission:structuredClone(admission) };
      attempts.push(record);
      if (admission.status !== 'rejected') {
        return {
          status:`world-${admission.status}`,
          admission,
          pipeline,
          attempts,
          retry:attempts.length > 1 ? attempts.at(-2).retry : null
        };
      }

      await restoreBefore();
      const retry = buildWorldRetryPlan(pipeline, {
        generatorConfigured:runtime.generation?.canGenerateAsset?.() === true,
        attempt,
        budget:this.retryBudget
      });
      record.retry = retry;
      if (retry.status !== 'retry-proposed') {
        return {
          status:'world-rejected',
          reason:admission.reasons?.[0] || 'WORLD_REJECTED',
          rolledBack:true,
          admission,
          pipeline,
          attempts,
          retry
        };
      }

      const generation = await this.materializeRetryAssets(retry);
      record.generation = generation.status === 'generated'
        ? { status:generation.status, assets:structuredClone(generation.assets) }
        : { status:generation.status, reason:generation.reason, ...(generation.error ? { error:generation.error } : {}) };
      if (generation.status !== 'generated') {
        const failedRetry = { ...retry, status:'generation-failed', retriable:false, generation:record.generation };
        record.retry = failedRetry;
        return {
          status:'world-rejected',
          reason:generation.reason || 'GENERATION_FAILED',
          rolledBack:true,
          admission,
          pipeline,
          attempts,
          retry:failedRetry
        };
      }
      candidate = generation.plan;
    }

    throw new Error('World retry loop exceeded its fixed budget');
  }

  recompile(options = {}) {
    return recompileWorldRevision(this.runtime, { ...options, pipeline:this.pipeline });
  }

  async materializeRetryAssets(retry) {
    const runtime = this.runtime;
    if (retry?.status !== 'retry-proposed') return { status:'not-requested', plan:retry?.nextIR || null, assets:[] };
    if (typeof runtime.generation?.generateAsset !== 'function') {
      return { status:'generation-failed', reason:'GENERATOR_UNAVAILABLE', plan:null, assets:[] };
    }

    const plan = structuredClone(retry.nextIR);
    const generated = [];
    for (const action of retry.actions || []) {
      if (action.kind !== 'enable-generation') continue;
      const entity = plan.entities.find((item) =>
        (action.instanceId && item.id === action.instanceId)
        || (!action.instanceId && item.asset?.query === action.query)
      );
      if (!entity) {
        return { status:'generation-failed', reason:'RETRY_ENTITY_NOT_FOUND', plan:null, assets:generated, action:structuredClone(action) };
      }

      const asset = entity.asset || {};
      const prompt = asset.prompt || asset.query || asset.type || action.query || '';
      let produced;
      try {
        produced = await runtime.generation.generateAsset(prompt, {
          ...(entity.id ? { instanceId:entity.id } : {}),
          ...(asset.provider ? { provider:asset.provider } : {})
        });
      } catch (error) {
        return {
          status:'generation-failed',
          reason:error?.code || 'GENERATION_FAILED',
          plan:null,
          assets:generated,
          error:{ code:error?.code || 'GENERATION_FAILED', message:error?.message || String(error) }
        };
      }

      const assetId = produced?.id || null;
      if (!assetId || runtime.assets?.has?.(assetId) !== true) {
        return {
          status:'generation-failed',
          reason:produced?.status || 'GENERATED_ASSET_NOT_PUBLISHED',
          plan:null,
          assets:generated,
          result:produced ? structuredClone(produced) : null
        };
      }
      entity.asset = { ...asset, assetId };
      generated.push({ instanceId:entity.id || null, assetId, status:produced.status || 'generated' });
    }

    return { status:'generated', plan, assets:generated };
  }
}
