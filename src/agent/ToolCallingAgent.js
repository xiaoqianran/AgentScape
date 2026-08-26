const SYSTEM_PROMPT = `You are AgentScape, a spatial agent controlling an interactive 3D world.
Use tools instead of inventing world state. Inspect objects before acting when identities or geometry are uncertain. Use listRelations/describeObjectRelations when semantic spatial relationships are more useful than raw coordinates. For multi-step scene edits use executeBatch only when those edits are genuinely atomic and synchronously rollback-safe; embodied actions, navigation, pickup/drop, and articulation requests are not batchable. After any world-changing tool, AgentScape forces a fresh planning round before another mutation. Therefore never assume several mutation tool calls in one assistant turn will all execute. The compact task observation in request context is current read-only evidence assembled from Runtime truth; recoveryHints are explicitly provisional suggestions, never proof that a recovery will work. Articulation blockerCandidates marked current-contact-at-failure mean those colliders were physically touching the failed Part at the observed failure; treat them as contact evidence, not proof of the unique root cause. Recovery proposals are provisional and capability/policy-scoped. If suggestRecoveryActions returns multiple eligible proposals, its recommended/rank ordering is deterministic recovery execution route cost, not a causal root-cause ranking. An articulated-blocker proposal is executable only from Runtime evidence: for one alternate action it must have a verified current Part state; for multiple alternate open/close actions Runtime must provide a selected blockerAction backed by non-causal actionRanking counterfactual geometry. Prefer actionRanking basis=rapier-shape-pairs / articulated-rapier-shape-counterfactual-v2 when available; when actionRanking.convergence is present, Physics-first selection is trustworthy only when Runtime reports convergence.status=stable after denser resampling. If Runtime downgraded to three-aabb-fallback because Physics evidence was unstable/unavailable, accept that downgrade and never resurrect the prior Physics rank yourself. Sample counts may be Runtime-selected adaptively from joint travel and collider extent, so never assume a fixed sample count. three-aabb-fallback is explicitly weaker provisional evidence. If a proposal includes worldCounterfactual / rapier-world-shape-query, both targetIntroducesNoCollision and actionIntroducesNoCollision must be true for the selected articulated recovery; a known third-object/environment collision is a hard veto and must never be resurrected by pairwise Physics rank or Three fallback. A counterfactualCalibration result is post-recovery observed contact consistency only: consistent does not verify the original task, and contradicted must not be hidden. Never choose an alternate action yourself, override the selected blockerAction, reinterpret a fallback as Physics verification, or skip the original retry because calibration looked consistent. Execute at most one recovery mutation from the current failure evidence epoch, then fresh-replan and retry the original failed mutation. A successful recovery mutation never clears the original unresolved task by itself. If an original retry fails with new blocker evidence while the Agent is still holding a blocker from recoverPickupBlocker, suggestRecoveryActions may return cleanupRecommended; use that cleanupRecoveryBlocker (or suggestRecoveryCleanup for diagnosis) before attempting another pickup recovery. Cleanup is housekeeping, not a second blocker recovery: after recovery-cleaned, fresh-replan and call suggestRecoveryActions again before any new recoverPickupBlocker. recovery-cleaned only verifies safe blocker cleanup; it never clears the original unresolved mutation, which still requires a verified original retry. Do not call read tools merely to reproduce evidence already present in task context. When a deterministic failed mutation remains unresolved and its recovery hint names no diagnostic tool, normally report the task incomplete unless you can identify a different world-changing recovery. Recovery observation rounds are bounded; use the compact task evidence first and do not spend the budget on redundant reads. If a world-changing result is blocked, failed, unverified, request-only, or errors, do not advance to a later dependent subtask: diagnose, recover, retry, or report the task incomplete. After building or editing a world, use validateWorld and repairWorld rather than assuming the result is valid. When an asset is needed, always searchAssets first; generateAsset only if no suitable reusable asset exists. Generated/imported assets can be asset-provisional; that status is not world verification. For AI-generated multi-object worlds, first call proposeWorldIR with the semantic proposal, then wait for a fresh planning round and submit only the returned Runtime-issued worldIR to runWorldPipeline. Never invent revision or provenance yourself. This split is mandatory: proposeWorldIR is read-only compile preflight; runWorldPipeline is the mutation/admission boundary. World IR is a proposal, not truth: give every planned entity a stable id and express executable requirements only through fields declared by the tool schema. Never invent unsupported fields or spatial constraints. In World IR entities, asset.assetId is a reusable catalog id from searchAssets; asset.query/type/prompt may resolve a missing asset. Use capabilityIntent only for capabilities the resolved asset must actually expose, interactions for executable commands, rules only through the typed set-state grammar, and acceptance for conditions Runtime must verify. initialState is semantic scalar state only; never use it to forge Runtime ownership, navigation, physics, articulation, or verification evidence. When the user does not constrain exact coordinates, omit transform.position and let Runtime compose a collision-preflighted deterministic placement. For NEAR without an explicit user distance, omit distance and let Runtime derive safe collider-based spacing. Never claim a generated world complete from generateAsset/importEmbodiedGenAsset + spawnAsset alone. runWorldPipeline may internally perform one bounded retry only for search-missing assets when generation is available; its final world-ready/world-provisional/world-rejected status is authoritative. world-ready already includes the canonical validation/repair/admission pass, so do not call validateWorld or other redundant confirmation tools afterward unless diagnosing a non-ready result. Persisted acceptance evidence restored from a scene is historical only; call replayWorldAcceptance before relying on it, and accept it only when the replay returns world-accepted for the current revision. If a final world-rejected result says retry is exhausted or not-retriable, never resubmit the identical World IR revision; create a new revision from the returned findings or report the task incomplete. world-provisional remains unverified and world-rejected must be treated as failure.
Prefer place/findFreeSpace over guessing coordinates. If findPath is blocked, use suggestNavigationActions for provisional diagnosis; never treat its counterfactual recommendation as world truth. Execute any suggested interaction explicitly, then call findPath again after the world state changes. Move embodied agent objects with navigateTo instead of moveObject; navigateTo returns only after the physical walk arrives or becomes blocked. For embodied open/close tasks, call approachAndInteract directly; it already performs interaction-pose search, navigateTo, distance/physical line-of-sight checks, action-sweep clearance, motor request, and live joint completion observation. Only status=action-completed with targetReached=true and settled=true confirms final success. action-failed means a deterministic failure such as STALL; action-unverified means completion could not be proven such as TIMEOUT. Use getArticulationStatus only for diagnosis or later observation, not as a redundant query after action-completed. For embodied pickup, call approachAndPickup instead of low-level pickup; held means kinematic-anchor ownership and explicitly does not mean grasp force verification. For placing an Agent-held object onto a support surface, call approachAndPlace(actorId, supportId); the held object is inferred automatically, supportId is the receiving object such as table_01, and optional surfaceId is only a surface name such as top. Never pass the held object as supportId or an object id as surfaceId. Only status=placed with supportVerified=true confirms success after Dynamic settle; that result is already the deterministic post-condition, so do not issue redundant relation queries unless diagnosing a failed/unverified place. Use dropHeld only for an unconstrained release. Never claim a world mutation succeeded unless the tool result confirms it.
Keep the final response concise.`;

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
  constructor({ tools, gateway, fallbackGateway, log = () => {}, maxSteps = 8, maxRecoveryReadRounds = 4 }) {
    this.tools = tools;
    this.gateway = gateway;
    this.fallbackGateway = fallbackGateway;
    this.log = log;
    this.maxSteps = maxSteps;
    this.maxRecoveryReadRounds = maxRecoveryReadRounds;
  }

  get mode() { return this.gateway?.isConfigured() ? 'llm' : 'local'; }

  async run(text, { forceFallback = false } = {}) {
    this.log(`goal: ${text}`, 'goal');
    const messages = [
      { role:'system', content:SYSTEM_PROMPT },
      { role:'user', content:text }
    ];
    const gateway = !forceFallback && this.gateway?.isConfigured() ? this.gateway : this.fallbackGateway;
    if (!gateway) throw new Error('No agent gateway available');

    const execution = [];
    if (this.tools.runtime) this.tools.runtime.lastAcceptanceBundle = null;
    const unresolvedMutations = new Map();
    const appliedAuxiliaryRecoveries = new Map();
    const attemptedWorldPlans = new Set();
    const toolDefinitions=this.tools.definitions();
    const proposalGateEnabled=toolDefinitions.some((tool)=>tool.name==='proposeWorldIR');
    const issuedWorldRevisions=new Set();
    let pendingWorldProposalLineage=null;
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
        const acceptanceBundle=this.tools.runtime?.lastAcceptanceBundle ? structuredClone(this.tools.runtime.lastAcceptanceBundle) : null;
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
        let result;
        try {
          const internalContext=call.name==='proposeWorldIR' && pendingWorldProposalLineage
            ? {worldProposalLineage:structuredClone(pendingWorldProposalLineage)} : null;
          result = internalContext
            ? await this.tools.call(call.name,call.args,internalContext)
            : await this.tools.call(call.name,call.args);
        } catch (error) {
          result = { error:error.message, code:error.code || 'TOOL_ERROR' };
        }
        const safeResult = result === undefined ? { ok:true } : result;
        const policy = this.tools.executionPolicy?.(call.name, safeResult) || {
          mutates:false, barrier:false, batchable:true, batchAcceptable:true,
          outcome:safeResult?.error ? {state:'error',verified:false,reason:safeResult.code || 'TOOL_ERROR'} : {state:'accepted',verified:null}
        };
        const proposalRevisionId=call.name==='proposeWorldIR' && safeResult?.status==='world-proposal-ready'
          ? safeResult.worldIR?.revision?.id : null;
        const proposalBarrier=Boolean(proposalRevisionId);
        if(proposalRevisionId){
          issuedWorldRevisions.add(proposalRevisionId);
          pendingWorldProposalLineage={parentRevisionId:proposalRevisionId};
        }
        if(call.name==='runWorldPipeline'){
          pendingWorldProposalLineage=worldProposalLineageFromExecution(call,safeResult) || pendingWorldProposalLineage;
        }
        const sequence = policy.barrier || proposalBarrier ? {
          outcome:policy.outcome,
          barrier:Boolean(policy.barrier),
          ...(proposalBarrier?{planningBarrier:true}:{}),
          replanRequired:true,
          instruction:proposalBarrier
            ? 'World IR proposal compiled without mutating Runtime. Replan from this issued revision before runWorldPipeline.'
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
            tool:call.name,outcome:structuredClone(policy.outcome),skipReason:'REPLAN_REQUIRED_AFTER_WORLD_PROPOSAL',
            instruction:'World IR proposal compiled without mutating Runtime. Replan from this issued revision before runWorldPipeline.'
          };
          this.tools.recordSequence?.({...entry,planningBarrier:true,replanRequired:true,worldRevisionId:proposalRevisionId});
          this.log(`sequence: ${call.name} → ${proposalRevisionId} · fresh planning round required`,'tool');
        }

        if (policy.barrier) {
          mutationExecuted = true;
          const identity = policy.auxiliary && recoveryOf ? recoveryMutationIdentity(call,recoveryOf) : mutationIdentity(call,safeResult);
          barrier = { tool:call.name, outcome:structuredClone(policy.outcome) };
          lastMutation = { planningStep:step + 1, tool:call.name, identity, args:structuredClone(call.args || {}), outcome:structuredClone(policy.outcome) };
          if (policy.tracksUnresolved !== false) {
            // Any retry of the original semantic mutation starts a new evidence epoch.
            appliedAuxiliaryRecoveries.delete(identity);
            if (COMPLETE_OUTCOMES.has(policy.outcome.state)) unresolvedMutations.delete(identity);
            else unresolvedMutations.set(identity,{ planningStep:step + 1, tool:call.name, identity, args:structuredClone(call.args || {}), outcome:structuredClone(policy.outcome) });
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
