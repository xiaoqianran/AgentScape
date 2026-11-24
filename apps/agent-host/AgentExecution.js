import { changesWorld, STUDIO_TOOL_NAMES } from './McpWorldTools.js';
import { STUDIO_PROJECT_TOOL_SET } from '../../application/agent/StudioProjectTools.js';
import { acceptedSceneChecks } from '../../application/agent/TaskEvidence.js';

// Reuse the actual server-side tool catalog; connection setup tools are read-only.
const KNOWN_TOOLS = new Set([...STUDIO_TOOL_NAMES,'session_attach','studio_session_status']);
const ASSET_WRITES = new Set(['asset_build_submit','asset_build_publish']);
const TERMINAL_FAILURES = new Set(['failed','rejected','interrupted','error']);

function decode(value) {
  if (typeof value !== 'string') return value && typeof value === 'object' ? value : {};
  try { return JSON.parse(value); } catch { return {}; }
}

function payloadFrom(result) {
  const text = result?.content?.find?.(item => item.type === 'text')?.text;
  const value = decode(text);
  return value?.content && !value?.schema && !value?.status ? payloadFrom(value) : value;
}

function toolName(name) {
  return String(name || '').replace(/^mcp__agentscape__/, '');
}

/** Retain only audit-safe tool metadata; source code and arbitrary tool arguments are not logged. */
export function executionRecord({ name, callId, args, result, isError = false, durationMs } = {}) {
  const tool = toolName(name), input = decode(args), payload = payloadFrom(result);
  const allowed = KNOWN_TOOLS.has(tool);
  const error = isError || !allowed || TERMINAL_FAILURES.has(payload?.status) ||
    payload?.state === 'failed';
  const failedVerify = tool === 'scene_verify' && !acceptedSceneChecks(payload).length;
  const approvalRequired = tool==='studio_project' && input.operation==='run' && isError &&
    /PROJECT_EXECUTION_REVIEW_REQUIRED/.test(String(result?.content?.find?.(item=>item.type==='text')?.text||''));
  const reason = !allowed ? 'AGENT_TOOL_FORBIDDEN' : approvalRequired ? 'PROJECT_EXECUTION_REVIEW_REQUIRED' : isError ? 'TOOL_FAILED'
    : failedVerify ? 'SCENE_UNVERIFIED'
    : error ? 'TOOL_FAILED' : undefined;
  // Bounded diagnostic codes, never raw source or arbitrary tool result bodies.
  const failedChecks=tool==='scene_verify'&&Array.isArray(payload?.verification?.evidence?.checks)
    ?payload.verification.evidence.checks.filter(check=>check?.verified!==true).slice(0,32).map(check=>({
      id:typeof check?.id==='string'?check.id.slice(0,100):null,
      kind:typeof check?.kind==='string'?check.kind.slice(0,48):null,
      reason:/^[A-Z_]{3,80}$/.test(check?.reason||'')?check.reason:'CHECK_UNVERIFIED'
    })):[];
  // Save receipts bind persisted bytes to the exact live project and scene.
  const saved=tool==='studio_project'&&input.operation==='save'&&payload.status==='succeeded'&&
    typeof payload.projectId==='string'&&payload.value?.id===payload.projectId&&
    typeof payload.runtimeId==='string'&&payload.runtimeId.length>0&&payload.runtimeId.length<=80&&
    Number.isSafeInteger(payload.projectRevision)&&Number.isSafeInteger(payload.revision)&&
    /^[a-f0-9]{64}$/.test(payload.value?.integrity||'')
    ?{projectId:payload.projectId,runtimeId:payload.runtimeId,projectRevision:payload.projectRevision,
      sceneRevision:payload.revision,digest:payload.value.integrity}:null;
  return {
    tool, toolCallId:String(callId || ''), executed:true,
    mutates:allowed && (changesWorld(tool,input) || ASSET_WRITES.has(tool)),
    ...(Number.isFinite(durationMs) ? {durationMs} : {}),
    ...(tool==='scene_timeline'?{operation:input.command??'status'}:
      ((STUDIO_PROJECT_TOOL_SET.has(tool)||tool==='scene_history')&&typeof input.operation==='string'?{operation:input.operation}:{})),
    ...(saved&&!reason?{savedCheckpoint:saved}:{}),
    ...(failedChecks.length?{failedChecks}:{}),
    ...(tool === 'scene_add_model' && typeof input.model?.id === 'string' ? {targetId:input.model.id} : {}),
    ...(tool === 'scene_verify' && Array.isArray(input.criteria) ? {criteria:input.criteria} : {}),
    ...(Number.isSafeInteger(payload?.revision) ? {revision:payload.revision} : {}),
    outcome:{state:reason ? 'failed' : tool === 'scene_verify' ? 'verified' : 'accepted',...(reason ? {reason} : {})}
  };
}

/** Normalize actual Pi SDK completion records or DSH session tool/call + tool/result events. */
export function normalizeExecution(backend, events = []) {
  if (backend === 'pi') return events.map(executionRecord);
  if (backend !== 'dsh') throw new Error('AGENT_BACKEND_INVALID');
  const pending = new Map(), execution = [];
  for (const event of events) {
    const data = event?.data || {};
    if (event?.type === 'tool/call') {
      pending.set(data.callId,{name:data.name,callId:data.callId,args:data.arguments});
    } else if (event?.type === 'tool/result') {
      const callId = data.message?.toolCallId;
      const call = pending.get(callId);
      if (!call) {
        execution.push(executionRecord({name:'unknown',callId,isError:true}));
        continue;
      }
      pending.delete(callId);
      execution.push(executionRecord({...call,result:data.message,
        isError:Boolean(data.message?.isError || data.error)}));
    }
  }
  for (const call of pending.values())
    execution.push({...executionRecord({...call,isError:true}),
      outcome:{state:'failed',reason:'TOOL_RESULT_MISSING'}});
  return execution;
}
