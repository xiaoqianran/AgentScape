import { describe, expect, it, vi } from 'vitest';
import { WorldBuilder } from '../../modules/world/build/WorldBuilder.js';

const harness = ({ pipelineRun, restore } = {}) => {
  const runtime = {
    snapshot:vi.fn(() => ({ scene:'before' })),
    restore:restore || vi.fn(async () => {}),
    currentWorldRevision:{revision:{id:'before'},provenance:{source:'test'}},
    currentBehaviorBundle:{ruleGraph:[{id:'rule-before'}]},
    currentPhysicsRequirements:{requirements:[]},
    lastAcceptanceBundle:{result:{status:'world-accepted'}},
    restoredAcceptanceEvidence:{worldRevisionId:'before'},
    interactionEvidence:new Map([['before',{verified:true}]]),
    loadRuleGraph:vi.fn(),
    clearObjects:vi.fn(async () => {}),
    generation:{ canGenerateAsset:vi.fn(() => false) }
  };
  const pipeline = { run:pipelineRun || vi.fn() };
  return { runtime, pipeline, builder:new WorldBuilder(runtime,{ pipeline }) };
};

describe('WorldBuilder rollback', () => {
  it('restores scene and authority when the canonical pipeline throws after destructive preparation', async () => {
    const failure = Object.assign(new Error('compiler exploded'), { code:'COMPILER_FAILED' });
    const h = harness();
    h.pipeline.run.mockImplementation(async () => {
      h.runtime.currentWorldRevision={revision:{id:'mutated'}};
      h.runtime.currentBehaviorBundle={ruleGraph:[{id:'mutated'}]};
      throw failure;
    });

    await expect(h.builder.run({})).rejects.toBe(failure);

    expect(h.runtime.loadRuleGraph).toHaveBeenNthCalledWith(1, []);
    expect(h.runtime.clearObjects).toHaveBeenCalledWith({ silent:true });
    expect(h.runtime.restore).toHaveBeenCalledOnce();
    expect(h.runtime.restore).toHaveBeenCalledWith({ scene:'before' });
    expect(h.runtime.currentWorldRevision).toMatchObject({revision:{id:'before'}});
    expect(h.runtime.currentBehaviorBundle).toEqual({ruleGraph:[{id:'rule-before'}]});
    expect(h.runtime.loadRuleGraph).toHaveBeenLastCalledWith([{id:'rule-before'}]);
  });

  it('restores the original world when destructive preparation itself throws', async () => {
    const failure = Object.assign(new Error('clear failed'), { code:'CLEAR_FAILED' });
    const h = harness();
    h.runtime.clearObjects.mockImplementation(async () => {
      h.runtime.currentWorldRevision={revision:{id:'mutated'}};
      throw failure;
    });

    await expect(h.builder.run({})).rejects.toBe(failure);

    expect(h.pipeline.run).not.toHaveBeenCalled();
    expect(h.runtime.restore).toHaveBeenCalledOnce();
    expect(h.runtime.currentWorldRevision).toMatchObject({revision:{id:'before'}});
    expect(h.runtime.loadRuleGraph).toHaveBeenLastCalledWith([{id:'rule-before'}]);
  });

  it('surfaces rollback failure without hiding the original build failure', async () => {
    const buildFailure = Object.assign(new Error('compiler exploded'), { code:'COMPILER_FAILED' });
    const rollbackFailure = new Error('restore failed');
    const h = harness({
      pipelineRun:vi.fn(async () => { throw buildFailure; }),
      restore:vi.fn(async () => { throw rollbackFailure; })
    });

    await expect(h.builder.run({})).rejects.toMatchObject({
      code:'WORLD_BUILD_ROLLBACK_FAILED',
      cause:buildFailure,
      rollbackError:rollbackFailure
    });
  });
});
