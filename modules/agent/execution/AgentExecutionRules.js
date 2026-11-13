
export const COMPLETE_OUTCOMES = new Set(['verified', 'accepted']);

export const stableValue = (value) => {
  if (Array.isArray(value)) return `[${value.map(stableValue).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((key)=>`${JSON.stringify(key)}:${stableValue(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
};

const EMBODIED_STRING_ARGS = Object.freeze({
  approachAndInteract:['actorId','targetId','action','partName'],
  approachAndPickup:['actorId','targetId'],
  approachAndPlace:['actorId','supportId','targetId','surfaceId']
});

const unwrapRedundantQuotedString = (value) => {
  if (typeof value !== 'string') return value;
  const trimmed=value.trim();
  if (trimmed.length < 2 || trimmed[0] !== '"' || trimmed.at(-1) !== '"') return value;
  try {
    const parsed=JSON.parse(trimmed);
    return typeof parsed === 'string' ? parsed : value;
  } catch { return value; }
};

export const normalizeModelToolCall = (call) => {
  if (!call || typeof call !== 'object') return call;
  const args={...(call.args || {})};
  for (const key of EMBODIED_STRING_ARGS[call.name] || []) {
    if (key in args) args[key]=unwrapRedundantQuotedString(args[key]);
  }
  if (EMBODIED_STRING_ARGS[call.name] && args.actorId == null && args.agentId != null) {
    args.actorId=unwrapRedundantQuotedString(args.agentId);
    delete args.agentId;
  }
  if (call.name === 'approachAndPlace' && args.supportId == null && args.targetId != null) {
    args.supportId=args.targetId;
    delete args.targetId;
  }
  return {...call,args};
};

export const mutationIdentity = (call, result = null) => {
  const args = call.args || {};
  if(call.name==='interactScene')return `interactScene:${stableValue(args.interaction || {})}`;
  const keys = ['actorId','id','targetId','supportId','blockerId','blockerPartName','blockerAction','action','assetId','instanceId','end'];
  const scope = Object.fromEntries(keys.filter((key)=>args[key] != null).map((key)=>[key,args[key]]));
  const partName = args.partName ?? result?.partName ?? result?.interaction?.part ?? result?.actionSweep?.partName;
  if (partName != null) scope.partName=partName;
  return `${call.name}:${stableValue(scope)}`;
};

export const worldMutationRevisionId=(entry)=>{
  if(entry?.tool==='runWorldPipeline') return entry.args?.plan?.revision?.id || null;
  if(entry?.tool==='recompileWorldRevision') return entry.args?.proposal?.nextRevisionId || null;
  return null;
};

export const worldPlanIdentity = (call) => {
  if(call?.name!=='runWorldPipeline') return null;
  const plan=call.args?.plan || {};
  const {revision:_revision,provenance:_provenance,...semanticPlan}=plan;
  return `runWorldPipeline:${stableValue({plan:semanticPlan})}`;
};

export const worldProposalLineageFromExecution = (call,result) => {
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

export const worldRevisionRepairFromExecution=(result)=>{
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

export const recoveryOriginIdentity = (call, unresolvedMutations) => {
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

export const recoveryMutationIdentity = (call, recoveryOf) => {
  if (!recoveryOf) return mutationIdentity(call);
  const originScope=identityScope(recoveryOf);
  const args={...(call.args || {})};
  if (args.partName == null && originScope.partName != null) args.partName=originScope.partName;
  return mutationIdentity({...call,args});
};

export const replanInstruction = (outcome) => COMPLETE_OUTCOMES.has(outcome?.state)
  ? 'World state changed. Replan from the fresh world before any further mutation.'
  : 'This step did not verify completion. Do not advance to a later dependent mutation; diagnose, recover, retry, or report the task incomplete.';

export function annotateResult(result, sequence) {
  if (result && typeof result === 'object' && !Array.isArray(result)) return { ...result, _sequence:sequence };
  return { result, _sequence:sequence };
}
