/* Runs a single model-selected tool with the original trusted internal context. */
export async function invokeAgentTool(tools, call, {
  signal, pendingWorldProposalLineage = null, pendingWorldRevisionRepair = null,
  issuedWorldRevisionProposals = new Map()
} = {}) {
  const acceptanceBefore = tools.runtime?.lastAcceptanceBundle || null;
  let result;
  let invocationFailed = false;
  try {
    let internalContext = call.name === 'interactScene' ? { signal } : null;
    if (call.name === 'proposeWorldIR' && pendingWorldProposalLineage)
      internalContext = { worldProposalLineage: structuredClone(pendingWorldProposalLineage) };
    if (call.name === 'proposeWorldRevision' && pendingWorldRevisionRepair)
      internalContext = { worldRevisionRepair: structuredClone(pendingWorldRevisionRepair) };
    if (call.name === 'recompileWorldRevision') {
      const issued = issuedWorldRevisionProposals.get(call.args?.proposal?.nextRevisionId);
      if (issued) internalContext = { worldRevisionBaseIR: structuredClone(issued.baseWorldIR) };
    }
    result = internalContext
      ? await tools.call(call.name, call.args, internalContext)
      : await tools.call(call.name, call.args);
  } catch (error) {
    invocationFailed = true;
    result = { error:error.message, code:error.code || 'TOOL_ERROR' };
  }
  const acceptanceAfter = tools.runtime?.lastAcceptanceBundle || null;
  const acceptanceChanged = acceptanceAfter !== acceptanceBefore;
  const safeResult = result === undefined ? { ok:true } : result;
  const policy = tools.executionPolicy?.(call.name, safeResult) || {
    mutates:false, barrier:false, batchable:true, batchAcceptable:true,
    outcome:safeResult?.error
      ? {state:'error',verified:false,reason:safeResult.code || 'TOOL_ERROR'}
      : {state:'accepted',verified:null}
  };
  return {
    safeResult, policy, invocationFailed, acceptanceChanged,
    acceptanceBundle:acceptanceChanged && acceptanceAfter ? structuredClone(acceptanceAfter) : null
  };
}
