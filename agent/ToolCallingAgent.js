import { buildAgentSystemPrompt } from './prompt/index.js';


const COMPLETE_OUTCOMES = new Set(['verified', 'accepted']);

const stableValue = (value) => {
  if (Array.isArray(value)) return `[${value.map(stableValue).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((key)=>`${JSON.stringify(key)}:${stableValue(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
};

const mutationIdentity = (call, result = null) => {
  const args = call.args || {};
  const keys = ['actorId','id','targetId','supportId','blockerId','blockerPartName','blockerAction','action','assetId','instanceId','end'];
  const scope = Object.fromEntries(keys.filter((key)=>args[key] != null).map((key)=>[key,args[key]]));
  const partName = args.partName ?? result?.partName ?? result?.interaction?.part ?? result?.actionSweep?.partName;
  if (partName != null) scope.partName=partName;
  return `${call.name}:${stableValue(scope)}`;
};

const worldMutationRevisionId=(entry)=>{
  if(entry?.tool==='runWorldPipeline') return entry.args?.plan?.revision?.id || null;
  if(entry?.tool==='recompileWorldRevision') return entry.args?.proposal?.nextRevisionId || null;
  return null;
};

const worldPlanIdentity = (call) => {
  if(call?.name!=='runWorldPipeline') return null;
  const plan=call.args?.plan || {};
  const {revision:_revision,provenance:_provenance,...semanticPlan}=plan;
  return `runWorldPipeline:${stableValue({plan:semanticPlan})}`;
};

const worldProposalLineageFromExecution = (call,result) => {
  const parentRevisionId=call?.args?.plan?.revision?.id || null;
  if(!parentRevisionId) return null;
  const rejected=result?.status!=='world-ready';
  const revisionContext=result?.pipeline?.state?.artifacts?.revisionContext;
  const acceptanceFindings=result?.pipeline?.state?.artifacts?.acceptanceEvidence?.findings || [];
  const retryFindings=(result?.attempts || []).flatMap((attempt)=>attempt?.retry?.findings || []);
  const evidenceRefs=[
    ...(revisionContext?.findingIds || []),
    ...acceptanceFindings.map((finding)=>finding?.id),
    ...retryFindings.map((finding)=>finding?.id)
  ].filter(Boolean);
  return {
    parentRevisionId,
    ...(rejected?{reason:result?.reason || result?.admission?.reasons?.[0] || 'world-revision'}:{}),
    ...(evidenceRefs.length?{evidenceRefs:[...new Set(evidenceRefs)]}:{})
  };
};

const worldRevisionRepairFromExecution=(result)=>{
  if(result?.status!=='world-rejected') return null;
  const baseWorldIR=result?.worldIR || result?.pipeline?.state?.artifacts?.worldIR;
  const revisionContext=result?.pipeline?.state?.artifacts?.revisionContext;
  if(!baseWorldIR||!revisionContext||revisionContext.baseRevisionId!==baseWorldIR.revision?.id) return null;
  return {baseWorldIR:structuredClone(baseWorldIR),revisionContext:structuredClone(revisionContext)};
};

const identityScope = (identity) => {
  const separator=identity?.indexOf(':') ?? -1;
  if (separator < 0) return {};
  try { return JSON.parse(identity.slice(separator + 1)); } catch { return {}; }
};

const recoveryOriginIdentity = (call, unresolvedMutations) => {
  if (!['recoverPickupBlocker','recoverArticulatedBlocker','cleanupRecoveryBlocker'].includes(call.name)) return null;
  const args=call.args || {};
  const matches=[...unresolvedMutations.values()].filter((entry)=>{
    if (entry.tool !== 'approachAndInteract') return false;
    const scope=identityScope(entry.identity);
    return scope.actorId===args.actorId
      && scope.targetId===args.targetId
      && (!args.partName || scope.partName===args.partName);
  });
  return matches.at(-1)?.identity || null;
};

const recoveryMutationIdentity = (call, recoveryOf) => {
  if (!recoveryOf) return mutationIdentity(call);
  const originScope=identityScope(recoveryOf);
  const args={...(call.args || {})};
  if (args.partName == null && originScope.partName != null) args.partName=originScope.partName;
  return mutationIdentity({...call,args});
};

const replanInstruction = (outcome) => COMPLETE_OUTCOMES.has(outcome?.state)
  ? 'World state changed. Replan from the fresh world before any further mutation.'
  : 'This step did not verify completion. Do not advance to a later dependent mutation; diagnose, recover, retry, or report the task incomplete.';

function annotateResult(result, sequence) {
  if (result && typeof result === 'object' && !Array.isArray(result)) return { ...result, _sequence:sequence };
  return { result, _sequence:sequence };
}

export class ToolCallingAgent {
  constructor({ tools, gateway, log = () => {}, maxSteps = 8, maxRecoveryReadRounds = 4 }) {
    this.tools = tools;
    this.gateway = gateway;
    this.log = log;
    this.maxSteps = maxSteps;
    this.maxRecoveryReadRounds = maxRecoveryReadRounds;
  }

  get mode() { return this.gateway?.isConfigured() ? 'llm' : 'unconfigured'; }

  async run(text) {
    this.log(`goal: ${text}`, 'goal');
    const toolDefinitions=this.tools.definitions();
    const messages = [
      { role:'system', content:buildAgentSystemPrompt(toolDefinitions) },
      { role:'user', content:text }
    ];
    const gateway = this.gateway?.isConfigured() ? this.gateway : null;
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

    for (let step = 0; step < this.maxSteps; step++) {
      const world = await this.tools.call('listObjects');
      const unresolved = [...unresolvedMutations.values()].map((entry)=>structuredClone(entry));
      const task = this.tools.taskObservation?.({ lastMutation:lastMutation ? structuredClone(lastMutation) : null, unresolvedMutations:unresolved }) || null;
      if (this.tools.runtime) this.tools.runtime.lastTaskObservation = task ? structuredClone(task) : null;
      const response = await gateway.complete({
        messages,
        tools:toolDefinitions,
        context:{
          world:lastMutation ? { count:world.length, index:world.map(({id,asset})=>({id,asset})) } : world,
          ...(task ? { task } : {}),
          ...(unresolved.length ? { recovery:{
            readOnlyRoundsUsed:recoveryReadRounds,
            readOnlyRoundsRemaining:Math.max(0,this.maxRecoveryReadRounds-recoveryReadRounds)
          } } : {})
        }
      });
      if (!response.toolCalls.length) {
        const proposedFinal = response.message || '任务完成。';
        const unresolved = [...unresolvedMutations.values()].map((entry)=>structuredClone(entry));
        const acceptanceBundle=taskAcceptanceBundle ? structuredClone(taskAcceptanceBundle) : null;
        const acceptanceRequired=acceptanceBundle?.required===true;
        const acceptanceAccepted=!acceptanceRequired || acceptanceBundle?.result?.status==='world-accepted';
        const lastComplete = lastMutation && COMPLETE_OUTCOMES.has(lastMutation.outcome.state);
        const taskStatus = !lastMutation ? 'no-mutation' : lastComplete && !unresolved.length && acceptanceAccepted ? 'completed' : 'incomplete';
        const final = acceptanceRequired && !acceptanceAccepted
          ? `Task incomplete: world acceptance is ${acceptanceBundle?.result?.status || 'missing'}.`
          : proposedFinal;
        if (taskStatus === 'incomplete') {
          const detail = !acceptanceAccepted ? `world acceptance → ${acceptanceBundle?.result?.status || 'missing'}` : unresolved.length ? `${unresolved.length} unresolved mutation(s)` : `${lastMutation.tool} → ${lastMutation.outcome.state}`;
          this.log(`sequence: task incomplete · ${detail}`, 'error');
        }
        this.log(final, 'result');
        return { message:final, steps:step + 1, taskStatus, lastMutation:lastMutation ? structuredClone(lastMutation) : null, unresolvedMutations:unresolved, execution:structuredClone(execution), ...(acceptanceBundle?{acceptanceBundle}:{}) };
      }
      const worldBuildVerified=lastMutation
        && ['runWorldPipeline','recompileWorldRevision'].includes(lastMutation.tool)
        && COMPLETE_OUTCOMES.has(lastMutation.outcome?.state)
        && !unresolved.length;
      const redundantPostWorldReads=worldBuildVerified
        && response.toolCalls.every((call)=>!this.tools.executionPolicy?.(call.name,undefined)?.mutates);
      if(redundantPostWorldReads){
        messages.push({role:'assistant',content:response.message || '',toolCalls:response.toolCalls});
        const instruction='The world build is already Runtime-verified and current task context is fresh. Do not issue read-only confirmation calls. Either perform the next required world mutation from current context or finalize.';
        for(const call of response.toolCalls){
          const skipped={status:'not-executed',reason:'WORLD_READY_REDUNDANT_READ',instruction,_sequence:{outcome:{state:'skipped',verified:false},barrier:false,replanRequired:true}};
          messages.push({role:'tool',toolCallId:call.id,name:call.name,content:JSON.stringify(skipped)});
          execution.push({planningStep:step+1,tool:call.name,args:structuredClone(call.args || {}),executed:false,outcome:{state:'skipped',verified:false},reason:skipped.reason});
          this.tools.recordSequence?.({planningStep:step+1,tool:call.name,executed:false,reason:skipped.reason,replanRequired:true});
        }
        this.log('skip: redundant read-only confirmation after verified world build','plan');
        continue;
      }
      const readOnlyRecovery = unresolved.length && recoveryReadRounds >= this.maxRecoveryReadRounds
        && response.toolCalls.every((call)=>!this.tools.executionPolicy?.(call.name,undefined)?.mutates);
      if (readOnlyRecovery) {
        const message=`Task incomplete: recovery observation limit reached with ${unresolved.length} unresolved world mutation(s).`;
        this.log(`sequence: ${message}`,'error');
        for (const call of response.toolCalls) execution.push({
          planningStep:step+1,tool:call.name,args:structuredClone(call.args || {}),executed:false,
          outcome:{state:'skipped',verified:false},reason:'RECOVERY_OBSERVATION_LIMIT'
        });
        this.tools.recordSequence?.({
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

      let barrier = null;
      let executedTool = false;
      let mutationExecuted = false;
      for (const call of response.toolCalls) {
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
          this.tools.recordSequence?.({ planningStep:step + 1, tool:call.name, executed:false, reason:skipped.reason, afterTool:barrier.tool, afterOutcome:barrier.outcome.state });
          this.log(`skip: ${call.name} · replan after ${barrier.tool}`, 'plan');
          continue;
        }

        const previewPolicy=this.tools.executionPolicy?.(call.name,undefined) || {};
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
            this.tools.recordSequence?.({planningStep:step+1,tool:call.name,executed:false,reason:skipped.reason,replanRequired:true});
            this.log(`skip: ${call.name} · compiled World IR proposal required`,'plan');
            barrier={tool:call.name,outcome:{state:'skipped',verified:false},skipReason:'REPLAN_REQUIRED_AFTER_WORLD_PROPOSAL_GATE',instruction:skipped.instruction};
            continue;
          }
        }
        if(revisionProposalGateEnabled && call.name==='proposeWorldRevision' && !pendingWorldRevisionRepair){
          const skipped={status:'not-executed',reason:'WORLD_REVISION_CONTEXT_REQUIRED',instruction:'No bounded Runtime revision context is available. Use proposeWorldIR for a full semantic revision, or report the task incomplete.',_sequence:{outcome:{state:'skipped',verified:false},barrier:false,replanRequired:true}};
          messages.push({role:'tool',toolCallId:call.id,name:call.name,content:JSON.stringify(skipped)});
          execution.push({planningStep:step+1,tool:call.name,args:structuredClone(call.args||{}),executed:false,outcome:{state:'skipped',verified:false},reason:skipped.reason});
          this.tools.recordSequence?.({planningStep:step+1,tool:call.name,executed:false,reason:skipped.reason,replanRequired:true});
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
            this.tools.recordSequence?.({planningStep:step+1,tool:call.name,executed:false,reason,replanRequired:true});
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
          this.tools.recordSequence?.({planningStep:step+1,tool:call.name,executed:false,reason:skipped.reason,planIdentity,replanRequired:true});
          this.log(`skip: ${call.name} · exact World IR semantics already attempted`, 'plan');
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
          this.tools.recordSequence?.({
            planningStep:step+1,tool:call.name,executed:false,reason:skipped.reason,
            auxiliary:true,recoveryOf,recoveryIdentity,replanRequired:true
          });
          this.log(`skip: ${call.name} · recovery already applied; retry original mutation`, 'plan');
          barrier={
            tool:call.name,outcome:{state:'skipped',verified:false},
            skipReason:'REPLAN_REQUIRED_AFTER_RECOVERY_GATE'
          };
          continue;
        }

        this.log(`plan: ${call.name} ${JSON.stringify(call.args)}`, 'plan');
        executedTool = true;
        const acceptanceBefore=this.tools.runtime?.lastAcceptanceBundle || null;
        let result;
        try {
          let internalContext=null;
          if(call.name==='proposeWorldIR' && pendingWorldProposalLineage) internalContext={worldProposalLineage:structuredClone(pendingWorldProposalLineage)};
          if(call.name==='proposeWorldRevision' && pendingWorldRevisionRepair) internalContext={worldRevisionRepair:structuredClone(pendingWorldRevisionRepair)};
          if(call.name==='recompileWorldRevision'){
            const issued=issuedWorldRevisionProposals.get(call.args?.proposal?.nextRevisionId);
            if(issued) internalContext={worldRevisionBaseIR:structuredClone(issued.baseWorldIR)};
          }
          result = internalContext ? await this.tools.call(call.name,call.args,internalContext) : await this.tools.call(call.name,call.args);
        } catch (error) {
          result = { error:error.message, code:error.code || 'TOOL_ERROR' };
        }
        const acceptanceAfter=this.tools.runtime?.lastAcceptanceBundle || null;
        if(acceptanceAfter!==acceptanceBefore) taskAcceptanceBundle=acceptanceAfter?structuredClone(acceptanceAfter):null;
        const safeResult = result === undefined ? { ok:true } : result;
        const policy = this.tools.executionPolicy?.(call.name, safeResult) || {
          mutates:false, barrier:false, batchable:true, batchAcceptable:true,
          outcome:safeResult?.error ? {state:'error',verified:false,reason:safeResult.code || 'TOOL_ERROR'} : {state:'accepted',verified:null}
        };
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
        this.log(`result: ${call.name} ${JSON.stringify(safeResult)}`, safeResult?.error ? 'error' : 'tool');
        if (planIdentity) attemptedWorldPlans.add(planIdentity);
        if(proposalBarrier){
          barrier={
            tool:call.name,outcome:structuredClone(policy.outcome),
            skipReason:boundedRevisionId?'REPLAN_REQUIRED_AFTER_WORLD_REVISION_PROPOSAL':'REPLAN_REQUIRED_AFTER_WORLD_PROPOSAL',
            instruction:proposalInstruction
          };
          this.tools.recordSequence?.({...entry,planningBarrier:true,replanRequired:true,...(proposalRevisionId?{worldRevisionId:proposalRevisionId}:{}),...(boundedRevisionId?{worldRevisionProposalId:boundedRevisionId}:{})});
          this.log(`sequence: ${call.name} → ${proposalRevisionId||boundedRevisionId} · fresh planning round required`,'tool');
        }

        if (policy.barrier) {
          mutationExecuted = true;
          const identity = policy.auxiliary && recoveryOf ? recoveryMutationIdentity(call,recoveryOf) : mutationIdentity(call,safeResult);
          barrier = { tool:call.name, outcome:structuredClone(policy.outcome) };
          lastMutation = { planningStep:step + 1, tool:call.name, identity, args:structuredClone(call.args || {}), outcome:structuredClone(policy.outcome) };
          if (policy.tracksUnresolved !== false) {
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
          this.tools.recordSequence?.({ ...entry, identity, barrier:true, replanRequired:true, unresolved:unresolvedMutations.size });
          this.log(`sequence: ${call.name} → ${policy.outcome.state} · replan required`, COMPLETE_OUTCOMES.has(policy.outcome.state) ? 'tool' : 'error');
        }
      }

      if (!unresolvedMutations.size || mutationExecuted) recoveryReadRounds=0;
      else if (executedTool) recoveryReadRounds += 1;
    }
    const unresolved = [...unresolvedMutations.values()].map((entry)=>structuredClone(entry));
    if (unresolved.length) {
      const message = `Task incomplete: planning limit reached with ${unresolved.length} unresolved world mutation(s).`;
      this.log(`sequence: ${message}`, 'error');
      this.tools.recordSequence?.({
        planningStep:this.maxSteps, executed:false, termination:'planning-limit',
        unresolved:unresolved.length,
        lastMutation:lastMutation ? structuredClone(lastMutation) : null
      });
      return {
        message, steps:this.maxSteps, taskStatus:'incomplete', termination:'planning-limit',
        lastMutation:lastMutation ? structuredClone(lastMutation) : null,
        unresolvedMutations:unresolved, execution:structuredClone(execution)
      };
    }
    throw new Error(`Agent exceeded ${this.maxSteps} planning steps`);
  }
}
