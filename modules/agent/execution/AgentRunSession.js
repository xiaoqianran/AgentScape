import { buildAgentSystemPrompt } from '../prompt/index.js';
import { invokeAgentTool } from './AgentToolInvoker.js';
import { finalizeModelResponse, finalizePlanningLimit } from './AgentRunResults.js';
import {
  COMPLETE_OUTCOMES, stableValue, normalizeModelToolCall, mutationIdentity,
  worldMutationRevisionId, worldPlanIdentity, worldProposalLineageFromExecution,
  worldRevisionRepairFromExecution, recoveryOriginIdentity, recoveryMutationIdentity,
  replanInstruction, annotateResult
} from './AgentExecutionRules.js';

/** One execution context per run. Tool and world authority remain in the injected AgentTools. */
export async function executeAgentRun(agent, text, { signal, actor = agent.tools.actor } = {}) {
  const { tools, gateway:configuredGateway, maxSteps, maxRecoveryReadRounds, maxUnchangedFailures } = agent;
  // Preserve the public logger callback's original Agent receiver.
  const log = (...args) => agent.log(...args);
  log(`goal: ${text}`, 'goal');
  let toolDefinitions=tools.definitions();
  const messages = [
    { role:'system', content:buildAgentSystemPrompt(toolDefinitions) },
    { role:'user', content:text }
  ];
  const gateway = configuredGateway?.isConfigured() ? configuredGateway : null;
  if (!gateway) { const error=new Error('智能体能力不可用'); error.code='AGENT_CAPABILITY_UNAVAILABLE'; throw error; }

  const execution = [];
  let taskAcceptanceBundle=null;
  const unresolvedMutations = new Map();
  const appliedAuxiliaryRecoveries = new Map();
  const attemptedWorldPlans = new Set();
  const proposalGateEnabled=toolDefinitions.some((tool)=>tool.name==='proposeWorldIR');
  const revisionProposalGateEnabled=toolDefinitions.some((tool)=>tool.name==='proposeWorldRevision');
  const issuedWorldRevisions=new Set();
  const issuedWorldRevisionProposals=new Map();
  let pendingWorldProposalLineage=null;
  let pendingWorldRevisionRepair=null;
  let lastMutation = null;
  let recoveryReadRounds = 0;
  let sceneTaskPlan=null,sceneGoalEvidence=null;
  const failedSceneAttempts=new Map();
  const hasSceneObservation=toolDefinitions.some(tool=>tool.name==='observeScene');
  const refreshSceneGoals=async()=>{
    if(!sceneTaskPlan)return;
    sceneGoalEvidence=await tools.call('verifyScene',{criteria:sceneTaskPlan.criteria});
    const satisfied=new Set(sceneGoalEvidence.checks.filter(check=>check.verified).map(check=>check.id));
    for(const [identity,pending] of unresolvedMutations)if(pending.tool==='interactScene' && satisfied.has(pending.args.goalId))unresolvedMutations.delete(identity);
  };
  const cancelled = (steps) => ({
    message:'任务已停止；已完成的世界变化已保留。重试将重新观察当前世界。',
    taskStatus:'cancelled', termination:'user-cancelled', steps,
    lastMutation:lastMutation ? structuredClone(lastMutation) : null,
    unresolvedMutations:[...unresolvedMutations.values()].map((entry)=>structuredClone(entry)),
    execution:structuredClone(execution),
    ...(taskAcceptanceBundle ? { acceptanceBundle:structuredClone(taskAcceptanceBundle) } : {})
  });

  // OBSERVE -> PLAN: prepare fresh context, then ask the model for a decision.
  async function preparePlanningRound(step) {
    toolDefinitions=tools.definitions();
    messages[0]={role:'system',content:buildAgentSystemPrompt(toolDefinitions)};
    if (signal?.aborted) return { cancelled:cancelled(step) };
    const world = await tools.call('listObjects');
    if (signal?.aborted) return { cancelled:cancelled(step) };
    const scene=hasSceneObservation ? await tools.call('observeScene',actor?{actor}:{}) : null;
    await refreshSceneGoals();
    const unresolved = [...unresolvedMutations.values()].map((entry)=>structuredClone(entry));
    const task = tools.taskObservation?.({ actor,lastMutation:lastMutation ? structuredClone(lastMutation) : null, unresolvedMutations:unresolved }) || null;
    if(task && sceneTaskPlan)task.plan={...structuredClone(sceneTaskPlan),verification:structuredClone(sceneGoalEvidence)};
    if (tools.runtime) tools.runtime.lastTaskObservation = task ? structuredClone(task) : null;
    let response;
    try { response = await gateway.complete({
      messages,
      tools:toolDefinitions,
      context:{
        world:lastMutation ? { count:world.length, index:world.map(({id,asset})=>({id,asset})) } : world,
        ...(scene?{scene}:{}),
        ...(task ? { task } : {}),
        ...(unresolved.length ? { recovery:{
          readOnlyRoundsUsed:recoveryReadRounds,
          readOnlyRoundsRemaining:Math.max(0,maxRecoveryReadRounds-recoveryReadRounds)
        } } : {})
      }
    }, { signal }); }
    catch (error) {
      if (signal?.aborted) return { cancelled:cancelled(step + 1) };
      throw error;
    }
    if (signal?.aborted) return { cancelled:cancelled(step + 1) };
    response.toolCalls = response.toolCalls.map(normalizeModelToolCall);
    return { response, scene, unresolved };
  }

  // COMPLETE: re-check declared goals; the model response alone is not proof.
  // COMPLETE: a model reply is not proof of the requested world state.
  async function finishModelResponse(response, step) {
    await refreshSceneGoals();
    if (signal?.aborted) return cancelled(step + 1);
    return finalizeModelResponse({
      response, step, taskAcceptanceBundle, lastMutation, sceneTaskPlan,
      sceneGoalEvidence, unresolvedMutations, execution, log
    });
  }

  // EXECUTE -> REPLAN: enforce tool sequencing, verification and recovery barriers.
  async function executeToolBatch(response, step, scene) {
    let barrier = null;
    let executedTool = false;
    let mutationExecuted = false;
    for (const call of response.toolCalls) {
      // A running world tool finishes at its own safe boundary. Never drop a
      // held object or roll back a completed action merely to stop planning.
      if (signal?.aborted) return cancelled(step + 1);
      if (barrier) {
        const skipped = {
          status:'not-executed',
          reason:barrier.skipReason || 'REPLAN_REQUIRED_AFTER_WORLD_CHANGE',
          afterTool:barrier.tool,
          afterOutcome:barrier.outcome.state,
          instruction:barrier.instruction || replanInstruction(barrier.outcome),
          _sequence:{ outcome:{state:'skipped',verified:false}, barrier:false, replanRequired:true }
        };
        messages.push({ role:'tool', toolCallId:call.id, name:call.name, content:JSON.stringify(skipped) });
        execution.push({ planningStep:step + 1, tool:call.name, args:structuredClone(call.args || {}), executed:false, outcome:{state:'skipped',verified:false}, reason:skipped.reason });
        tools.recordSequence?.({ planningStep:step + 1, tool:call.name, executed:false, reason:skipped.reason, afterTool:barrier.tool, afterOutcome:barrier.outcome.state });
        log(`skip: ${call.name} · replan after ${barrier.tool}`, 'plan');
        continue;
      }

      const previewPolicy=tools.executionPolicy?.(call.name,undefined) || {};
      let sceneCallFingerprint=null;
      if(call.name==='planSceneTask' || call.name==='interactScene') {
        if(call.name==='interactScene')await refreshSceneGoals();
        const goal=sceneTaskPlan?.criteria.find(check=>check.id===call.args?.goalId);
        const satisfied=new Set((sceneGoalEvidence?.checks || []).filter(check=>check.verified).map(check=>check.id));
        const identity=mutationIdentity(call),previous=failedSceneAttempts.get(identity);
        const custom = call.args?.interaction?.action === 'custom';
        const fingerprint=scene ? stableValue({objects:scene.objects.map(object=>({id:object.id,state:object.state,transform:{...object.transform,position:object.transform.position.map(value=>Math.round(value*100)/100)}})),environment:scene.affordances.entities.filter(entry=>entry.source==='environment').map(entry=>({id:entry.id,state:entry.state})),project:scene.project?.entities.map(entry=>({id:entry.id,state:entry.state,actions:entry.actions}))}) : null;
        const reason=call.name==='planSceneTask' ? sceneTaskPlan?'TASK_PLAN_IMMUTABLE':null
          : !sceneTaskPlan?'TASK_PLAN_REQUIRED':!goal?'TASK_GOAL_UNKNOWN':!custom&&!actor?'ACTOR_SELECTION_REQUIRED':!custom&&call.args?.interaction?.actor!==actor?'TASK_ACTOR_MISMATCH'
          : (sceneTaskPlan.dependencies[goal.id] || []).some(parent=>!satisfied.has(parent))?'TASK_DEPENDENCY_UNSATISFIED'
          : satisfied.has(goal.id)?'TASK_GOAL_ALREADY_VERIFIED'
          : previous?.fingerprint===fingerprint && previous.count>=maxUnchangedFailures?'UNCHANGED_FAILURE_LIMIT':null;
        if(reason) {
          const skipped={status:'not-executed',reason,instruction:'Choose an unsatisfied goal, inspect fresh affordances, and change the route/action or report incomplete. Do not weaken or replace declared goals.'};
          messages.push({role:'tool',toolCallId:call.id,name:call.name,content:JSON.stringify(skipped)});
          execution.push({planningStep:step+1,tool:call.name,args:structuredClone(call.args || {}),executed:false,outcome:{state:'skipped',verified:false},reason});
          barrier={tool:call.name,outcome:{state:'skipped',verified:false},skipReason:reason};continue;
        }
        sceneCallFingerprint=fingerprint;
      }
      if(proposalGateEnabled && call.name==='runWorldPipeline'){
        const revisionId=call.args?.plan?.revision?.id;
        if(!revisionId || !issuedWorldRevisions.has(revisionId)){
          const skipped={
            status:'not-executed',reason:'WORLD_PIPELINE_PROPOSAL_REQUIRED',
            instruction:'Call proposeWorldIR first, observe the compiled Runtime-issued worldIR in a fresh planning round, then submit that exact revision to runWorldPipeline.',
            _sequence:{outcome:{state:'skipped',verified:false},barrier:false,replanRequired:true}
          };
          messages.push({role:'tool',toolCallId:call.id,name:call.name,content:JSON.stringify(skipped)});
          execution.push({planningStep:step+1,tool:call.name,args:structuredClone(call.args || {}),executed:false,outcome:{state:'skipped',verified:false},reason:skipped.reason});
          tools.recordSequence?.({planningStep:step+1,tool:call.name,executed:false,reason:skipped.reason,replanRequired:true});
          log(`skip: ${call.name} · compiled World IR proposal required`,'plan');
          barrier={tool:call.name,outcome:{state:'skipped',verified:false},skipReason:'REPLAN_REQUIRED_AFTER_WORLD_PROPOSAL_GATE',instruction:skipped.instruction};
          continue;
        }
      }
      if(revisionProposalGateEnabled && call.name==='proposeWorldRevision' && !pendingWorldRevisionRepair){
        const skipped={status:'not-executed',reason:'WORLD_REVISION_CONTEXT_REQUIRED',instruction:'No bounded Runtime revision context is available. Use proposeWorldIR for a full semantic revision, or report the task incomplete.',_sequence:{outcome:{state:'skipped',verified:false},barrier:false,replanRequired:true}};
        messages.push({role:'tool',toolCallId:call.id,name:call.name,content:JSON.stringify(skipped)});
        execution.push({planningStep:step+1,tool:call.name,args:structuredClone(call.args||{}),executed:false,outcome:{state:'skipped',verified:false},reason:skipped.reason});
        tools.recordSequence?.({planningStep:step+1,tool:call.name,executed:false,reason:skipped.reason,replanRequired:true});
        barrier={tool:call.name,outcome:{state:'skipped',verified:false},skipReason:'REPLAN_REQUIRED_AFTER_WORLD_REVISION_CONTEXT_GATE',instruction:skipped.instruction};
        continue;
      }
      if(revisionProposalGateEnabled && call.name==='recompileWorldRevision'){
        const proposal=call.args?.proposal;
        const nextRevisionId=proposal?.nextRevisionId;
        const issued=nextRevisionId?issuedWorldRevisionProposals.get(nextRevisionId):null;
        const reason=!issued?'WORLD_REVISION_PROPOSAL_REQUIRED':stableValue(proposal)!==issued.signature?'WORLD_REVISION_PROPOSAL_TAMPERED':null;
        if(reason){
          const skipped={status:'not-executed',reason,instruction:'Call proposeWorldRevision first and submit the returned proposal unchanged in a fresh planning round.',_sequence:{outcome:{state:'skipped',verified:false},barrier:false,replanRequired:true}};
          messages.push({role:'tool',toolCallId:call.id,name:call.name,content:JSON.stringify(skipped)});
          execution.push({planningStep:step+1,tool:call.name,args:structuredClone(call.args||{}),executed:false,outcome:{state:'skipped',verified:false},reason});
          tools.recordSequence?.({planningStep:step+1,tool:call.name,executed:false,reason,replanRequired:true});
          barrier={tool:call.name,outcome:{state:'skipped',verified:false},skipReason:'REPLAN_REQUIRED_AFTER_WORLD_REVISION_PROPOSAL_GATE',instruction:skipped.instruction};
          continue;
        }
      }
      const planIdentity=worldPlanIdentity(call);
      if (planIdentity && attemptedWorldPlans.has(planIdentity)) {
        const skipped={
          status:'not-executed',reason:'WORLD_PIPELINE_PLAN_ALREADY_ATTEMPTED',planIdentity,
          instruction:'This exact World IR semantic plan already ran in the current task. Revise the proposal from the returned rejection findings, or report the task incomplete; do not resubmit unchanged semantics under a new revision.',
          _sequence:{outcome:{state:'skipped',verified:false},barrier:false,replanRequired:true}
        };
        messages.push({role:'tool',toolCallId:call.id,name:call.name,content:JSON.stringify(skipped)});
        execution.push({planningStep:step+1,tool:call.name,args:structuredClone(call.args || {}),executed:false,outcome:{state:'skipped',verified:false},reason:skipped.reason,planIdentity});
        tools.recordSequence?.({planningStep:step+1,tool:call.name,executed:false,reason:skipped.reason,planIdentity,replanRequired:true});
        log(`skip: ${call.name} · exact World IR semantics already attempted`, 'plan');
        barrier={tool:call.name,outcome:{state:'skipped',verified:false},skipReason:'REPLAN_REQUIRED_AFTER_WORLD_PLAN_GATE'};
        continue;
      }
      const recoveryOf=previewPolicy.auxiliary ? recoveryOriginIdentity(call,unresolvedMutations) : null;
      const recoveryIdentity=previewPolicy.auxiliary ? recoveryMutationIdentity(call,recoveryOf) : null;
      if (recoveryOf && appliedAuxiliaryRecoveries.get(recoveryOf)?.has(recoveryIdentity)) {
        const skipped={
          status:'not-executed',reason:'RECOVERY_ALREADY_APPLIED',
          recoveryOf,recoveryIdentity,
          instruction:'This recovery already verified against the current failure evidence. Retry the original failed mutation before applying the same recovery again.',
          _sequence:{outcome:{state:'skipped',verified:false},barrier:false,replanRequired:true}
        };
        messages.push({role:'tool',toolCallId:call.id,name:call.name,content:JSON.stringify(skipped)});
        execution.push({
          planningStep:step+1,tool:call.name,args:structuredClone(call.args || {}),executed:false,
          outcome:{state:'skipped',verified:false},reason:skipped.reason,auxiliary:true,recoveryOf
        });
        tools.recordSequence?.({
          planningStep:step+1,tool:call.name,executed:false,reason:skipped.reason,
          auxiliary:true,recoveryOf,recoveryIdentity,replanRequired:true
        });
        log(`skip: ${call.name} · recovery already applied; retry original mutation`, 'plan');
        barrier={
          tool:call.name,outcome:{state:'skipped',verified:false},
          skipReason:'REPLAN_REQUIRED_AFTER_RECOVERY_GATE'
        };
        continue;
      }

      log(`plan: ${call.name} ${JSON.stringify(call.args)}`, 'plan');
      if (signal?.aborted) return cancelled(step + 1);
      executedTool = true;
      const invocation = await invokeAgentTool(tools, call, {
        signal, pendingWorldProposalLineage, pendingWorldRevisionRepair, issuedWorldRevisionProposals
      });
      const { safeResult, policy, invocationFailed } = invocation;
      if (invocation.acceptanceChanged) taskAcceptanceBundle = invocation.acceptanceBundle;
      if(call.name==='planSceneTask' && safeResult.status==='scene-task-plan') {
        sceneTaskPlan={criteria:structuredClone(safeResult.criteria),dependencies:structuredClone(safeResult.dependencies)};
        barrier={tool:call.name,outcome:{state:'accepted',verified:null},skipReason:'REPLAN_REQUIRED_AFTER_TASK_PLAN'};
      }
      if(call.name==='interactScene') {
        const identity=mutationIdentity(call),previous=failedSceneAttempts.get(identity);
        if(policy.outcome.verified)failedSceneAttempts.delete(identity);
        else failedSceneAttempts.set(identity,{fingerprint:sceneCallFingerprint,count:previous?.fingerprint===sceneCallFingerprint?previous.count+1:1});
      }
      const proposalRevisionId=call.name==='proposeWorldIR' && safeResult?.status==='world-proposal-ready' ? safeResult.worldIR?.revision?.id : null;
      const boundedRevisionId=call.name==='proposeWorldRevision' && safeResult?.status==='world-revision-proposal-ready' ? safeResult.proposal?.nextRevisionId : null;
      const proposalBarrier=Boolean(proposalRevisionId||boundedRevisionId);
      if(proposalRevisionId){
        issuedWorldRevisionProposals.clear();
        issuedWorldRevisions.add(proposalRevisionId);
        pendingWorldProposalLineage={parentRevisionId:proposalRevisionId};
        pendingWorldRevisionRepair=null;
      }
      if(boundedRevisionId && pendingWorldRevisionRepair){
        issuedWorldRevisionProposals.clear();
        issuedWorldRevisionProposals.set(boundedRevisionId,{signature:stableValue(safeResult.proposal),baseWorldIR:structuredClone(pendingWorldRevisionRepair.baseWorldIR)});
      }
      if(call.name==='runWorldPipeline'){
        issuedWorldRevisionProposals.clear();
        pendingWorldProposalLineage=worldProposalLineageFromExecution(call,safeResult) || pendingWorldProposalLineage;
        pendingWorldRevisionRepair=worldRevisionRepairFromExecution(safeResult);
      }
      if(call.name==='recompileWorldRevision'){
        issuedWorldRevisionProposals.delete(call.args?.proposal?.nextRevisionId);
        pendingWorldRevisionRepair=worldRevisionRepairFromExecution(safeResult);
      }
      const proposalInstruction=boundedRevisionId
        ? 'Bounded WorldRevision proposal compiled without mutating Runtime. Replan and submit this exact proposal to recompileWorldRevision.'
        : 'World IR proposal compiled without mutating Runtime. Replan from this issued revision before runWorldPipeline.';
      const sequence = policy.barrier || proposalBarrier ? {
        outcome:policy.outcome,
        barrier:Boolean(policy.barrier),
        ...(proposalBarrier?{planningBarrier:true}:{}),
        replanRequired:true,
        instruction:proposalBarrier
          ? proposalInstruction
          : replanInstruction(policy.outcome)
      } : null;
      const content = sequence ? annotateResult(safeResult, sequence) : safeResult;
      messages.push({ role:'tool', toolCallId:call.id, name:call.name, content:JSON.stringify(content) });
      const entry = {
        planningStep:step + 1, tool:call.name, args:structuredClone(call.args || {}), executed:true,
        outcome:structuredClone(policy.outcome), mutates:Boolean(policy.mutates), auxiliary:Boolean(policy.auxiliary),
        ...(recoveryOf ? { recoveryOf } : {})
      };
      execution.push(entry);
      log(`result: ${call.name} ${JSON.stringify(safeResult)}`, safeResult?.error ? 'error' : 'tool');
      if (planIdentity) attemptedWorldPlans.add(planIdentity);
      if(proposalBarrier){
        barrier={
          tool:call.name,outcome:structuredClone(policy.outcome),
          skipReason:boundedRevisionId?'REPLAN_REQUIRED_AFTER_WORLD_REVISION_PROPOSAL':'REPLAN_REQUIRED_AFTER_WORLD_PROPOSAL',
          instruction:proposalInstruction
        };
        tools.recordSequence?.({...entry,planningBarrier:true,replanRequired:true,...(proposalRevisionId?{worldRevisionId:proposalRevisionId}:{}),...(boundedRevisionId?{worldRevisionProposalId:boundedRevisionId}:{})});
        log(`sequence: ${call.name} → ${proposalRevisionId||boundedRevisionId} · fresh planning round required`,'tool');
      }

      if (policy.barrier) {
        mutationExecuted = true;
        const identity = policy.auxiliary && recoveryOf ? recoveryMutationIdentity(call,recoveryOf) : mutationIdentity(call,safeResult);
        barrier = { tool:call.name, outcome:structuredClone(policy.outcome) };
        lastMutation = { planningStep:step + 1, tool:call.name, identity, args:structuredClone(call.args || {}), outcome:structuredClone(policy.outcome) };
        if (policy.tracksUnresolved !== false && (!invocationFailed || call.name==='interactScene')) {
          // Any retry of the original semantic mutation starts a new evidence epoch.
          appliedAuxiliaryRecoveries.delete(identity);
          if (COMPLETE_OUTCOMES.has(policy.outcome.state)) {
            unresolvedMutations.delete(identity);
            if(call.name==='recompileWorldRevision'){
              const baseRevisionId=call.args?.proposal?.baseRevisionId;
              for(const [pendingIdentity,pending] of unresolvedMutations){
                if(baseRevisionId && worldMutationRevisionId(pending)===baseRevisionId) unresolvedMutations.delete(pendingIdentity);
              }
            }
          } else unresolvedMutations.set(identity,{ planningStep:step + 1, tool:call.name, identity, args:structuredClone(call.args || {}), outcome:structuredClone(policy.outcome) });
        } else if (policy.auxiliary && recoveryOf && COMPLETE_OUTCOMES.has(policy.outcome.state)) {
          if (!appliedAuxiliaryRecoveries.has(recoveryOf)) appliedAuxiliaryRecoveries.set(recoveryOf,new Set());
          appliedAuxiliaryRecoveries.get(recoveryOf).add(identity);
        }
        tools.recordSequence?.({ ...entry, identity, barrier:true, replanRequired:true, unresolved:unresolvedMutations.size });
        log(`sequence: ${call.name} → ${policy.outcome.state} · replan required`, COMPLETE_OUTCOMES.has(policy.outcome.state) ? 'tool' : 'error');
      }
    }

    if (!unresolvedMutations.size || mutationExecuted) recoveryReadRounds=0;
    else if (executedTool) recoveryReadRounds += 1;
  }

  // EXHAUST: do not declare success when the plan still has pending evidence.
  // EXHAUST: budget exhaustion is not proof of completion.
  async function finishAtLimit() {
    if (signal?.aborted) return cancelled(maxSteps);
    await refreshSceneGoals();
    return finalizePlanningLimit({
      maxSteps, taskAcceptanceBundle, lastMutation, sceneTaskPlan,
      sceneGoalEvidence, unresolvedMutations, execution, log,
      recordSequence:tools.recordSequence?.bind(tools)
    });
  }

  for (let step = 0; step < maxSteps; step++) {
    const planningRound = await preparePlanningRound(step);
    if (planningRound.cancelled) return planningRound.cancelled;
    const { response, scene, unresolved } = planningRound;
    if (!response.toolCalls.length) return finishModelResponse(response, step);
      const worldBuildVerified=lastMutation
        && ['runWorldPipeline','recompileWorldRevision'].includes(lastMutation.tool)
        && COMPLETE_OUTCOMES.has(lastMutation.outcome?.state)
        && !unresolved.length;
      const redundantPostWorldReads=worldBuildVerified
        && response.toolCalls.every((call)=>!tools.executionPolicy?.(call.name,undefined)?.mutates);
      if(redundantPostWorldReads){
        messages.push({role:'assistant',content:response.message || '',toolCalls:response.toolCalls});
        const instruction='The world build is already Runtime-verified and current task context is fresh. Do not issue read-only confirmation calls. Either perform the next required world mutation from current context or finalize.';
        for(const call of response.toolCalls){
          const skipped={status:'not-executed',reason:'WORLD_READY_REDUNDANT_READ',instruction,_sequence:{outcome:{state:'skipped',verified:false},barrier:false,replanRequired:true}};
          messages.push({role:'tool',toolCallId:call.id,name:call.name,content:JSON.stringify(skipped)});
          execution.push({planningStep:step+1,tool:call.name,args:structuredClone(call.args || {}),executed:false,outcome:{state:'skipped',verified:false},reason:skipped.reason});
          tools.recordSequence?.({planningStep:step+1,tool:call.name,executed:false,reason:skipped.reason,replanRequired:true});
        }
        log('skip: redundant read-only confirmation after verified world build','plan');
        continue;
      }
      const readOnlyRecovery = unresolved.length && recoveryReadRounds >= maxRecoveryReadRounds
        && response.toolCalls.every((call)=>!tools.executionPolicy?.(call.name,undefined)?.mutates);
      if (readOnlyRecovery) {
        const message=`Task incomplete: recovery observation limit reached with ${unresolved.length} unresolved world mutation(s).`;
        log(`sequence: ${message}`,'error');
        for (const call of response.toolCalls) execution.push({
          planningStep:step+1,tool:call.name,args:structuredClone(call.args || {}),executed:false,
          outcome:{state:'skipped',verified:false},reason:'RECOVERY_OBSERVATION_LIMIT'
        });
        tools.recordSequence?.({
          planningStep:step+1,executed:false,termination:'recovery-observation-limit',
          recoveryReadRounds,unresolved:unresolved.length,
          lastMutation:lastMutation ? structuredClone(lastMutation) : null
        });
        return {
          message,steps:step+1,taskStatus:'incomplete',termination:'recovery-observation-limit',
          lastMutation:lastMutation ? structuredClone(lastMutation) : null,
          unresolvedMutations:unresolved,execution:structuredClone(execution)
        };
      }
      messages.push({ role:'assistant', content:response.message || '', toolCalls:response.toolCalls });

      const batchOutcome = await executeToolBatch(response, step, scene);
      if (batchOutcome) return batchOutcome;
    }
    return finishAtLimit();
}
