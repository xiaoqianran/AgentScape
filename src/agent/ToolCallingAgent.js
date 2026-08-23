const SYSTEM_PROMPT = `You are AgentScape, a spatial agent controlling an interactive 3D world.
Use tools instead of inventing world state. Inspect objects before acting when identities or geometry are uncertain. Use listRelations/describeObjectRelations when semantic spatial relationships are more useful than raw coordinates. For multi-step scene edits use executeBatch only when those edits are genuinely atomic and synchronously rollback-safe; embodied actions, navigation, pickup/drop, and articulation requests are not batchable. After any world-changing tool, AgentScape forces a fresh planning round before another mutation. Therefore never assume several mutation tool calls in one assistant turn will all execute. If a world-changing result is blocked, failed, unverified, request-only, or errors, do not advance to a later dependent subtask: diagnose, recover, retry, or report the task incomplete. After building or editing a world, use validateWorld and repairWorld rather than assuming the result is valid. When an asset is needed, always searchAssets first; generateAsset only if no suitable reusable asset exists.
Prefer place/findFreeSpace over guessing coordinates. If findPath is blocked, use suggestNavigationActions for provisional diagnosis; never treat its counterfactual recommendation as world truth. Execute any suggested interaction explicitly, then call findPath again after the world state changes. Move embodied agent objects with navigateTo instead of moveObject; navigateTo returns only after the physical walk arrives or becomes blocked. For embodied open/close tasks, call approachAndInteract directly; it already performs interaction-pose search, navigateTo, distance/physical line-of-sight checks, action-sweep clearance, motor request, and live joint completion observation. Only status=action-completed with targetReached=true and settled=true confirms final success. action-failed means a deterministic failure such as STALL; action-unverified means completion could not be proven such as TIMEOUT. Use getArticulationStatus only for diagnosis or later observation, not as a redundant query after action-completed. For embodied pickup, call approachAndPickup instead of low-level pickup; held means kinematic-anchor ownership and explicitly does not mean grasp force verification. For placing an Agent-held object onto a support surface, call approachAndPlace(actorId, supportId); the held object is inferred automatically, supportId is the receiving object such as table_01, and optional surfaceId is only a surface name such as top. Never pass the held object as supportId or an object id as surfaceId. Only status=placed with supportVerified=true confirms success after Dynamic settle; that result is already the deterministic post-condition, so do not issue redundant relation queries unless diagnosing a failed/unverified place. Use dropHeld only for an unconstrained release. Never claim a world mutation succeeded unless the tool result confirms it.
Keep the final response concise.`;

const COMPLETE_OUTCOMES = new Set(['verified', 'accepted']);

const stableValue = (value) => {
  if (Array.isArray(value)) return `[${value.map(stableValue).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((key)=>`${JSON.stringify(key)}:${stableValue(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
};

const mutationIdentity = (call) => {
  const args = call.args || {};
  const keys = ['actorId','id','targetId','supportId','action','partName','assetId','instanceId','end'];
  const scope = Object.fromEntries(keys.filter((key)=>args[key] != null).map((key)=>[key,args[key]]));
  return `${call.name}:${stableValue(scope)}`;
};

const replanInstruction = (outcome) => COMPLETE_OUTCOMES.has(outcome?.state)
  ? 'World state changed. Replan from the fresh world before any further mutation.'
  : 'This step did not verify completion. Do not advance to a later dependent mutation; diagnose, recover, retry, or report the task incomplete.';

function annotateResult(result, sequence) {
  if (result && typeof result === 'object' && !Array.isArray(result)) return { ...result, _sequence:sequence };
  return { result, _sequence:sequence };
}

export class ToolCallingAgent {
  constructor({ tools, gateway, fallbackGateway, log = () => {}, maxSteps = 8 }) {
    this.tools = tools;
    this.gateway = gateway;
    this.fallbackGateway = fallbackGateway;
    this.log = log;
    this.maxSteps = maxSteps;
  }

  get mode() { return this.gateway?.isConfigured() ? 'llm' : 'local'; }

  async run(text) {
    this.log(`goal: ${text}`, 'goal');
    const messages = [
      { role:'system', content:SYSTEM_PROMPT },
      { role:'user', content:text }
    ];
    const gateway = this.gateway?.isConfigured() ? this.gateway : this.fallbackGateway;
    if (!gateway) throw new Error('No agent gateway available');

    const execution = [];
    const unresolvedMutations = new Map();
    let lastMutation = null;

    for (let step = 0; step < this.maxSteps; step++) {
      const response = await gateway.complete({
        messages,
        tools:this.tools.definitions(),
        context:{ world:await this.tools.call('listObjects') }
      });
      if (!response.toolCalls.length) {
        const final = response.message || '任务完成。';
        const unresolved = [...unresolvedMutations.values()].map((entry)=>structuredClone(entry));
        const lastComplete = lastMutation && COMPLETE_OUTCOMES.has(lastMutation.outcome.state);
        const taskStatus = !lastMutation ? 'no-mutation' : lastComplete && !unresolved.length ? 'completed' : 'incomplete';
        if (taskStatus === 'incomplete') {
          const detail = unresolved.length ? `${unresolved.length} unresolved mutation(s)` : `${lastMutation.tool} → ${lastMutation.outcome.state}`;
          this.log(`sequence: task incomplete · ${detail}`, 'error');
        }
        this.log(final, 'result');
        return { message:final, steps:step + 1, taskStatus, lastMutation:lastMutation ? structuredClone(lastMutation) : null, unresolvedMutations:unresolved, execution:structuredClone(execution) };
      }
      messages.push({ role:'assistant', content:response.message || '', toolCalls:response.toolCalls });

      let barrier = null;
      for (const call of response.toolCalls) {
        if (barrier) {
          const skipped = {
            status:'not-executed',
            reason:'REPLAN_REQUIRED_AFTER_WORLD_CHANGE',
            afterTool:barrier.tool,
            afterOutcome:barrier.outcome.state,
            instruction:replanInstruction(barrier.outcome),
            _sequence:{ outcome:{state:'skipped',verified:false}, barrier:false, replanRequired:true }
          };
          messages.push({ role:'tool', toolCallId:call.id, name:call.name, content:JSON.stringify(skipped) });
          execution.push({ planningStep:step + 1, tool:call.name, args:structuredClone(call.args || {}), executed:false, outcome:{state:'skipped',verified:false}, reason:skipped.reason });
          this.tools.recordSequence?.({ planningStep:step + 1, tool:call.name, executed:false, reason:skipped.reason, afterTool:barrier.tool, afterOutcome:barrier.outcome.state });
          this.log(`skip: ${call.name} · replan after ${barrier.tool}`, 'plan');
          continue;
        }

        this.log(`plan: ${call.name} ${JSON.stringify(call.args)}`, 'plan');
        let result;
        try {
          result = await this.tools.call(call.name, call.args);
        } catch (error) {
          result = { error:error.message, code:error.code || 'TOOL_ERROR' };
        }
        const safeResult = result === undefined ? { ok:true } : result;
        const policy = this.tools.executionPolicy?.(call.name, safeResult) || {
          mutates:false, barrier:false, batchable:true, batchAcceptable:true,
          outcome:safeResult?.error ? {state:'error',verified:false,reason:safeResult.code || 'TOOL_ERROR'} : {state:'accepted',verified:null}
        };
        const sequence = policy.barrier ? {
          outcome:policy.outcome,
          barrier:true,
          replanRequired:true,
          instruction:replanInstruction(policy.outcome)
        } : null;
        const content = sequence ? annotateResult(safeResult, sequence) : safeResult;
        messages.push({ role:'tool', toolCallId:call.id, name:call.name, content:JSON.stringify(content) });
        const entry = { planningStep:step + 1, tool:call.name, args:structuredClone(call.args || {}), executed:true, outcome:structuredClone(policy.outcome), mutates:Boolean(policy.mutates) };
        execution.push(entry);
        this.log(`result: ${call.name} ${JSON.stringify(safeResult)}`, safeResult?.error ? 'error' : 'tool');

        if (policy.barrier) {
          const identity = mutationIdentity(call);
          barrier = { tool:call.name, outcome:structuredClone(policy.outcome) };
          lastMutation = { planningStep:step + 1, tool:call.name, identity, outcome:structuredClone(policy.outcome) };
          if (COMPLETE_OUTCOMES.has(policy.outcome.state)) unresolvedMutations.delete(identity);
          else unresolvedMutations.set(identity,{ planningStep:step + 1, tool:call.name, identity, args:structuredClone(call.args || {}), outcome:structuredClone(policy.outcome) });
          this.tools.recordSequence?.({ ...entry, identity, barrier:true, replanRequired:true, unresolved:unresolvedMutations.size });
          this.log(`sequence: ${call.name} → ${policy.outcome.state} · replan required`, COMPLETE_OUTCOMES.has(policy.outcome.state) ? 'tool' : 'error');
        }
      }
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
