import { meta } from '../skillPrimitives.js';

export function registerBatchSkills(add,runtime,registry) {
  add('executeBatch', { ...meta('把可同步回滚的 scene/world edits 作为一个原子批次执行；具身长动作、导航和 request-only articulation 不允许进入 batch。任一调用失败或返回 blocked/failed/unverified/requested 则回滚。', ['world.write'], ['calls'], { calls: { type: 'array', items: { type: 'object' } } }), batchable:false, mutates:true }, async (a, { context }) => {
    for (const call of a.calls) {
      const policy = registry.executionPolicy(call.name);
      if (!policy.batchable) return { committed:false, rolledBack:false, reason:'UNBATCHABLE_SKILL', skill:call.name, results:[] };
    }
    const before = runtime.snapshot();
    const results = [];
    for (const call of a.calls) {
      const result = await registry.invoke(call.name, call.args || {}, { ...context, skipHistory: true });
      const policy = registry.executionPolicy(call.name, result.result);
      results.push({ name:call.name, ...result, outcome:policy.outcome });
      if (!result.success || !policy.batchAcceptable) {
        await runtime.restore(before);
        return { committed:false, rolledBack:true, reason:result.success ? 'SEMANTIC_STEP_NOT_VERIFIED' : 'SKILL_ERROR', results };
      }
    }
    runtime.sceneGraph.changed();
    return { committed:true, rolledBack:false, results };
  });
}
