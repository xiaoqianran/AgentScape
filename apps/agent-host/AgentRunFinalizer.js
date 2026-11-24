import { connectStudioMcp } from './McpWorldTools.js';
import { requiredTaskCriteria } from './TaskSpec.js';

const code = value => typeof value === 'string' && /^[A-Z_]{3,80}$/.test(value) ? value : 'FINAL_VERIFICATION_UNAVAILABLE';

export function acceptedSceneChecks(result) {
  const evidence = result?.verification?.evidence;
  if (result?.schema !== 'agentscape.scene-result' || result.operation !== 'verify' ||
      result.status !== 'succeeded' || result.verification?.status !== 'verified' ||
      evidence?.status !== 'world-accepted' || !Array.isArray(evidence.checks) ||
      !evidence.checks.length || !evidence.checks.every(check => check?.verified === true)) return [];
  return evidence.checks;
}

function unresolvedOperations(execution) {
  const unresolved = new Map();
  for (const entry of execution) {
    const key = JSON.stringify([entry.tool,entry.operation || entry.targetId || '']);
    if (entry.outcome?.state === 'failed')
      unresolved.set(key,{tool:entry.tool,reason:entry.outcome.reason || 'TOOL_FAILED'});
    else unresolved.delete(key);
  }
  return [...unresolved.values()];
}

function lastIndex(entries,predicate) {
  for (let i=entries.length-1;i>=0;i--) if (predicate(entries[i])) return i;
  return -1;
}

function parseToolResponse(response) {
  const text = response?.content?.find(item=>item.type==='text')?.text;
  if (!text) throw Object.assign(new Error('FINAL_TOOL_RESPONSE_EMPTY'),{code:'FINAL_TOOL_RESPONSE_EMPTY'});
  return JSON.parse(text);
}

async function invoke(connection,name,args,signal) {
  const tool=connection.tools.find(item=>item.name===name);
  if (!tool) throw Object.assign(new Error('FINAL_TOOL_UNAVAILABLE'),{code:'FINAL_TOOL_UNAVAILABLE'});
  return parseToolResponse(await tool.execute('final-'+crypto.randomUUID(),args,signal));
}

/** The Host, not either model SDK, owns the final task admission decision. */
export async function finalizeRun({output={},project=null,configuration,signal,expectedWorldSessionId=null,taskSpec=null,
  deferVisualReview=false,mcpConnector=connectStudioMcp}={}) {
  const execution = Array.isArray(output.execution) ? output.execution : [];
  const mutations = execution.filter(entry=>entry.mutates && entry.outcome?.state!=='failed');
  const unresolved = unresolvedOperations(execution);
  const verificationIndex = lastIndex(execution,entry=>entry.tool==='scene_verify');
  const verificationCall = execution[verificationIndex];
  const lastMutation = lastIndex(execution,entry=>entry.mutates);
  const hasFailures = unresolved.length>0 || Boolean(output.error) || output.retryLimit ||
    ['error','failed','cancelled','interrupted','aborted','length'].includes(output.finishReason);
  let status = 'incomplete', reason = 'SCENE_VERIFICATION_MISSING';
  let checks=[],sceneRevision=null,projectRevision=null,runtimeId=null,savedCheckpoint=null,worldSessionId=project?.worldSessionId || output.worldSessionId || null;
  const projectId = project?.id || null;
  const projectScope = project ? project.worldSessionId+'/'+project.id : undefined;
  const format=()=>({
    ...output,schema:'agentscape.agent-run',schemaVersion:1,taskStatus:status,
    ...(taskSpec?{taskSpec}:{}),
    verified:status==='completed',steps:execution.length,execution,
    mutations:mutations.map(entry=>({tool:entry.tool,toolCallId:entry.toolCallId})),
    unresolvedMutations:status==='completed'||status==='no-mutation'?[]:
      [...unresolved,...(reason?[{reason}]:[])],
    worldSessionId,
    ...(projectId?{projectId}:{}),
    world:{worldSessionId,projectId,projectRevision,sceneRevision,runtimeId},
    ...(savedCheckpoint?{savedCheckpoint}:{}),
    verification:{scope:taskSpec?'task-criteria':'world-state',
      status:status==='completed'?'verified':'unverified',reason:status==='completed'?null:reason,
      worldSessionId,revision:sceneRevision,checks}
  });
  if(signal?.aborted || output.taskStatus==='cancelled'){status='cancelled';reason='RUN_CANCELLED';return format();}
  const expectedSession=project?.worldSessionId || expectedWorldSessionId || output.worldSessionId;
  if(expectedSession && output.worldSessionId && expectedSession!==output.worldSessionId){
    reason='WORLD_SESSION_CHANGED';return format();
  }
  if(mutations.length && !expectedSession){
    reason='WORLD_SESSION_UNBOUND';return format();
  }
  if(taskSpec?.status==='review-required'){
    reason=taskSpec.reason || 'TASK_SPEC_REVIEW_REQUIRED';return format();
  }
  if(taskSpec?.status==='ready' && taskSpec.requiredChecks?.length && !mutations.length){
    reason='TASK_REQUIRED_MUTATION_MISSING';return format();
  }  if(!mutations.length && !project && !hasFailures && !execution.some(entry=>entry.outcome?.state==='failed') && (output.taskStatus==='no-mutation'||execution.some(entry=>entry.outcome?.state==='accepted'))){
    status='no-mutation';reason=null;return format();
  }
  if(unresolved.some(entry=>entry.reason==='PROJECT_EXECUTION_REVIEW_REQUIRED')){
    status='awaiting-approval';reason='PROJECT_EXECUTION_REVIEW_REQUIRED';return format();
  }
  if(hasFailures){reason=output.finishReason==='length'?'MODEL_OUTPUT_TRUNCATED':'UNRESOLVED_TOOL_FAILURE';return format();}
  if(project && !mutations.length){reason='TASK_PROJECT_NOT_BUILT';return format();}
  if(taskSpec && taskSpec.status!=='ready'){reason=taskSpec.reason||'TASK_SPEC_REVIEW_REQUIRED';return format();}
  if(!verificationCall?.criteria?.length){reason='SCENE_VERIFICATION_MISSING';return format();}
  if(verificationIndex <= lastMutation){reason='SCENE_VERIFICATION_STALE';return format();}
  if(verificationCall.outcome?.state!=='verified'){reason='SCENE_VERIFICATION_FAILED';return format();}
  if(project){
    const saveIndex=lastIndex(execution,entry=>entry.tool==='studio_project'&&entry.operation==='save'&&entry.outcome?.state==='accepted');
    if(saveIndex<0||saveIndex<lastMutation){reason='PROJECT_NOT_SAVED';return format();}
    savedCheckpoint=execution[saveIndex].savedCheckpoint||null;
    if(!savedCheckpoint){reason='PROJECT_SAVE_EVIDENCE_MISSING';return format();}
  }

  let connection;
  try {
    connection=await mcpConnector({url:configuration.mcpUrl,token:configuration.mcpToken,signal,projectScope});
    if(expectedSession && connection.worldSessionId!==expectedSession){
      reason='WORLD_SESSION_CHANGED';return format();
    }
    worldSessionId=connection.worldSessionId;
    let projectState;
    if(project){
      projectState=await invoke(connection,'studio_project',{operation:'read'},signal);
      projectRevision=projectState.revision ?? null;
      runtimeId=projectState.runtimeId ?? null;
      if(projectState.project?.id!==project.id||!projectState.active||
          projectState.runningRevision!==projectState.revision||!runtimeId){
        reason='TASK_PROJECT_CHANGED';return format();
      }
      if(savedCheckpoint.projectId!==project.id||savedCheckpoint.projectRevision!==projectRevision||
          savedCheckpoint.runtimeId!==runtimeId){
        reason='PROJECT_SAVE_STALE';return format();
      }
      // Ordinary Three.js projects do not have to register an ontology.
      // Explicit strict task criteria remain checked by scene_verify below.
      if(taskSpec?.status==='ready' && !projectState.observation?.project?.entities?.length){
        reason='TASK_PROJECT_ENTITIES_MISSING';return format();
      }
    }
    const before=await invoke(connection,'scene_observe',{limit:1},signal);
    // User requirements win if an Agent tries to reuse a task-* id with weaker checks.
    const required=requiredTaskCriteria(taskSpec);
    const criteria=[...required,...verificationCall.criteria.filter(check=>
      !required.some(item=>item.id===check.id))];
    const existingTargets=new Set(criteria.filter(item=>item.kind==='object-exists').map(item=>item.targetId));
    for(const entry of mutations){
      if(entry.tool!=='scene_add_model'||!entry.targetId||existingTargets.has(entry.targetId))continue;
      criteria.push({id:'host-entity-'+criteria.length,kind:'object-exists',targetId:entry.targetId});
      existingTargets.add(entry.targetId);
    }
    if(!criteria.some(item=>item.kind==='world-valid'))criteria.push({id:'host-world-valid',kind:'world-valid'});
    if(criteria.length>32){reason='FINAL_CRITERIA_LIMIT';return format();}
    const verified=await invoke(connection,'scene_verify',{criteria},signal);
    const after=await invoke(connection,'scene_observe',{limit:1},signal);
    sceneRevision=verified.revision ?? null;
    checks=acceptedSceneChecks(verified);
    if(!checks.length){reason='SCENE_VERIFICATION_FAILED';return format();}
    if(!Number.isSafeInteger(sceneRevision) || before.revision!==sceneRevision ||
        after.revision!==sceneRevision){reason='SCENE_REVISION_CHANGED';return format();}
    if(project){
      if(savedCheckpoint.sceneRevision!==sceneRevision){reason='PROJECT_SAVE_STALE';return format();}
      const latest=await invoke(connection,'studio_project',{operation:'read'},signal);
      if(!latest.active||latest.project?.id!==project.id||latest.revision!==projectRevision||
          latest.runningRevision!==latest.revision||latest.runtimeId!==runtimeId){
        reason='PROJECT_REVISION_CHANGED';return format();
      }
    }
    if(taskSpec?.visual?.required && !deferVisualReview){reason='VISUAL_REVIEW_PENDING';return format();}
    status='completed';reason=null;
  } catch(error) {
    reason=signal?.aborted?'RUN_CANCELLED':code(error?.code);
    if(signal?.aborted)status='cancelled';
  } finally {
    try { await connection?.close(); } catch { /* Do not discard a verified result. */ }
  }
  return format();
}
