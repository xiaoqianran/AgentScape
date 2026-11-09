import { COMPLETE_OUTCOMES } from './AgentExecutionRules.js';

/** Finalize only from observed/verifiable state, never the model's prose alone. */
export function finalizeModelResponse({
  response, step, taskAcceptanceBundle, lastMutation, sceneTaskPlan,
  sceneGoalEvidence, unresolvedMutations, execution, log
}) {
  const proposedFinal = response.message || '任务完成。';
  const unresolved = [...unresolvedMutations.values()].map((entry)=>structuredClone(entry));
  const acceptanceBundle=taskAcceptanceBundle ? structuredClone(taskAcceptanceBundle) : null;
  const acceptanceRequired=acceptanceBundle?.required===true;
  const acceptanceAccepted=!acceptanceRequired || acceptanceBundle?.result?.status==='world-accepted';
  const lastComplete = lastMutation && COMPLETE_OUTCOMES.has(lastMutation.outcome.state);
  const sceneGoalsAccepted=!sceneTaskPlan || sceneGoalEvidence?.status==='world-accepted';
  const taskStatus = sceneTaskPlan ? sceneGoalsAccepted && !unresolved.length && acceptanceAccepted ? 'completed' : 'incomplete'
    : !lastMutation ? 'no-mutation' : lastComplete && !unresolved.length && acceptanceAccepted ? 'completed' : 'incomplete';
  const final = !sceneGoalsAccepted ? `任务未完成：${sceneGoalEvidence?.failedCount ?? sceneTaskPlan.criteria.length} 个目标尚未通过当前世界验证。`
    : sceneTaskPlan && unresolved.length ? `任务未完成：仍有 ${unresolved.length} 项操作失败需要处理。`
    : acceptanceRequired && !acceptanceAccepted
    ? `Task incomplete: world acceptance is ${acceptanceBundle?.result?.status || 'missing'}.`
    : proposedFinal;
  if (taskStatus === 'incomplete') {
    const detail = !sceneGoalsAccepted ? `${sceneGoalEvidence?.failedCount || 0} unsatisfied goal(s)` : !acceptanceAccepted ? `world acceptance → ${acceptanceBundle?.result?.status || 'missing'}` : unresolved.length ? `${unresolved.length} unresolved mutation(s)` : `${lastMutation?.tool || 'task'} → ${lastMutation?.outcome.state || 'incomplete'}`;
    log(`sequence: task incomplete · ${detail}`, 'error');
  }
  log(final, 'result');
  return { message:final, steps:step + 1, taskStatus, lastMutation:lastMutation ? structuredClone(lastMutation) : null, unresolvedMutations:unresolved, execution:structuredClone(execution), ...(sceneTaskPlan?{taskPlan:structuredClone(sceneTaskPlan),goalVerification:structuredClone(sceneGoalEvidence)}:{}),...(acceptanceBundle?{acceptanceBundle}:{}) };
}

/** Enforce the planning budget without silently dropping unresolved world changes. */
export function finalizePlanningLimit({
  maxSteps, taskAcceptanceBundle, lastMutation, sceneTaskPlan,
  sceneGoalEvidence, unresolvedMutations, execution, log, recordSequence
}) {
  if(sceneTaskPlan && sceneGoalEvidence?.status==='world-accepted' && !unresolvedMutations.size && (!taskAcceptanceBundle?.required || taskAcceptanceBundle.result?.status==='world-accepted'))return {
    message:'任务目标已通过当前世界验证。',steps:maxSteps,taskStatus:'completed',taskPlan:structuredClone(sceneTaskPlan),goalVerification:structuredClone(sceneGoalEvidence),
    lastMutation:lastMutation?structuredClone(lastMutation):null,unresolvedMutations:[],execution:structuredClone(execution)
  };
  const unresolved = [...unresolvedMutations.values()].map((entry)=>structuredClone(entry));
  if (unresolved.length || sceneTaskPlan) {
    const message = `Task incomplete: planning limit reached with ${unresolved.length} unresolved world mutation(s).`;
    log(`sequence: ${message}`, 'error');
    recordSequence?.({
      planningStep:maxSteps, executed:false, termination:'planning-limit',
      unresolved:unresolved.length,
      lastMutation:lastMutation ? structuredClone(lastMutation) : null
    });
    return {
      message, steps:maxSteps, taskStatus:'incomplete', termination:'planning-limit',
      lastMutation:lastMutation ? structuredClone(lastMutation) : null,
      unresolvedMutations:unresolved, execution:structuredClone(execution),...(sceneTaskPlan?{taskPlan:structuredClone(sceneTaskPlan),goalVerification:structuredClone(sceneGoalEvidence)}:{})
    };
  }
  throw new Error(`Agent exceeded ${maxSteps} planning steps`);
}
