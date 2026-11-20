import { changesWorld, STUDIO_TOOL_NAMES } from './McpWorldTools.js';

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
  const failedVerify = tool === 'scene_verify' && (!payload?.verification ||
    payload.verification.status !== 'verified' || payload.verification.evidence?.status !== 'world-accepted' ||
    !Array.isArray(payload.verification.evidence.checks) ||
    !payload.verification.evidence.checks.length ||
    payload.verification.evidence.checks.some(check => check.verified !== true));
  const approvalRequired = tool==='studio_project' && input.operation==='run' && isError &&
    /PROJECT_EXECUTION_REVIEW_REQUIRED/.test(String(result?.content?.find?.(item=>item.type==='text')?.text||''));
  const reason = !allowed ? 'AGENT_TOOL_FORBIDDEN' : approvalRequired ? 'PROJECT_EXECUTION_REVIEW_REQUIRED' : isError ? 'TOOL_FAILED'
    : failedVerify ? 'SCENE_UNVERIFIED'
    : error ? 'TOOL_FAILED' : undefined;
  return {
    tool, toolCallId:String(callId || ''), executed:true,
    mutates:allowed && (changesWorld(tool,input) || ASSET_WRITES.has(tool)),
    ...(Number.isFinite(durationMs) ? {durationMs} : {}),
    ...(tool === 'studio_project' && typeof input.operation === 'string' ? {operation:input.operation} : {}),
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
