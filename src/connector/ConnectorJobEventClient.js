import { ConnectorContractError } from './ConnectorSession.js';
import { connectorJobPhase, requireSafeJobId, sanitizeJobData } from '../jobs/GenerationJobProjection.js';

export const CONNECTOR_EVENTS_PATH='/connector/v1/events';
const FORBIDDEN_EVENT_KEY=/(authorization|api[-_]?key|access[-_]?token|refresh[-_]?token|secret|credential|signed[-_]?url|traceback|stack|prompt|image|bytes|remote.*id|function.*id|url)/i;
const SAFE_TYPE=/^job\.[a-z0-9._-]+$/i;
const SAFE_CORRELATION=/^[A-Za-z0-9._:-]{1,200}$/;
const clone=(value)=>value == null ? value : structuredClone(value);

const requireText=(value,field)=>{
  const text=String(value ?? '').trim();
  if (!text) throw new ConnectorContractError('CONNECTOR_JOB_EVENT_INVALID',`Job event requires ${field}`,{field});
  return text;
};

function sequence(value,field='sequence') {
  const n=Number(value);
  if (!Number.isSafeInteger(n) || n < 0) {
    throw new ConnectorContractError('CONNECTOR_JOB_EVENT_INVALID',`Job event ${field} must be a non-negative safe integer`,{field});
  }
  return n;
}

function timestamp(value) {
  const text=requireText(value,'timestamp');
  const time=Date.parse(text);
  if (!Number.isFinite(time)) throw new ConnectorContractError('CONNECTOR_JOB_EVENT_INVALID','Job event timestamp is invalid');
  return new Date(time).toISOString();
}

function safeMessage(value) {
  if (value == null || value === '') return null;
  const text=String(value).trim();
  if (text.length > 500 || /https?:\/\/|Bearer\s+/i.test(text)) {
    throw new ConnectorContractError('CONNECTOR_JOB_EVENT_UNSAFE','Job event message contains unsafe transport/provider detail');
  }
  return text;
}

function safeEventDetails(value,path='details') {
  if (value == null) return null;
  if (typeof value === 'string') {
    if (/https?:\/\/|Bearer\s+/i.test(value)) {
      throw new ConnectorContractError('CONNECTOR_JOB_EVENT_UNSAFE','Job event detail contains unsafe transport/provider text',{path});
    }
    return value;
  }
  if (Array.isArray(value)) return value.map((item,index)=>safeEventDetails(item,`${path}[${index}]`));
  if (typeof value !== 'object') return value;
  const out={};
  for (const [key,item] of Object.entries(value)) {
    if (FORBIDDEN_EVENT_KEY.test(key)) {
      throw new ConnectorContractError('CONNECTOR_JOB_EVENT_UNSAFE','Job event contains a forbidden detail field',{path:`${path}.${key}`});
    }
    out[key]=safeEventDetails(item,`${path}.${key}`);
  }
  return sanitizeJobData(out,path);
}

function optionalStatus(value,field) {
  if (value == null || value === '') return null;
  const status=String(value);
  if (!connectorJobPhase(status)) throw new ConnectorContractError('CONNECTOR_JOB_EVENT_INVALID',`Job event has unknown ${field}`,{field,status});
  return status;
}

function progress(value) {
  if (value == null) return null;
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ConnectorContractError('CONNECTOR_JOB_EVENT_INVALID','Job event progress must be an object');
  const out={};
  for (const key of ['kind','current','total','unit','label']) if (value[key] != null) out[key]=value[key];
  return safeEventDetails(out,'progress');
}

export function normalizeConnectorJobEvent(payload={}, { sseId=null }={}) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new ConnectorContractError('CONNECTOR_JOB_EVENT_INVALID','Job event payload must be an object');
  const eventSequence=sequence(payload.sequence);
  if (sseId != null && sequence(sseId,'SSE id') !== eventSequence) {
    throw new ConnectorContractError('CONNECTOR_JOB_EVENT_CONFLICT','SSE id does not match Job event sequence',{sseId,eventSequence});
  }
  const type=requireText(payload.type,'type');
  if (!SAFE_TYPE.test(type)) throw new ConnectorContractError('CONNECTOR_JOB_EVENT_INVALID','Job event type must use job.* namespace',{type});
  const attempt=Number(payload.attempt ?? 1);
  if (!Number.isSafeInteger(attempt) || attempt < 1) throw new ConnectorContractError('CONNECTOR_JOB_EVENT_INVALID','Job event attempt must be a positive integer');
  const correlationId=payload.correlationId == null ? null : String(payload.correlationId).trim();
  if (correlationId && !SAFE_CORRELATION.test(correlationId)) throw new ConnectorContractError('CONNECTOR_JOB_EVENT_INVALID','Job event correlationId is invalid');
  return {
    sequence:eventSequence,
    timestamp:timestamp(payload.timestamp),
    jobId:requireSafeJobId(payload.jobId,'jobId'),
    attempt,
    type,
    oldStatus:optionalStatus(payload.oldStatus,'oldStatus'),
    newStatus:optionalStatus(payload.newStatus,'newStatus'),
    stage:payload.stage == null ? null : String(payload.stage),
    progress:progress(payload.progress),
    message:safeMessage(payload.message),
    details:safeEventDetails(payload.details),
    correlationId
  };
}

export function connectorJobEventSignature(event) {
  return JSON.stringify(event);
}

function parseBlock(block) {
  let id=null;
  const data=[];
  for (const rawLine of block.split(/\r?\n/)) {
    if (!rawLine || rawLine.startsWith(':')) continue;
    const split=rawLine.indexOf(':');
    const field=split === -1 ? rawLine : rawLine.slice(0,split);
    let value=split === -1 ? '' : rawLine.slice(split+1);
    if (value.startsWith(' ')) value=value.slice(1);
    if (field === 'id') id=value;
    if (field === 'data') data.push(value);
  }
  if (!data.length) return null;
  let payload;
  try { payload=JSON.parse(data.join('\n')); }
  catch { throw new ConnectorContractError('CONNECTOR_JOB_EVENT_INVALID','SSE Job event data is not valid JSON'); }
  return normalizeConnectorJobEvent(payload,{sseId:id});
}

export function parseConnectorJobEventText(text='') {
  return String(text).split(/\r?\n\r?\n/).map(parseBlock).filter(Boolean);
}

async function* streamSseEvents(body) {
  if (!body?.getReader) throw new ConnectorContractError('CONNECTOR_JOB_EVENT_INVALID','Connector SSE response has no readable body');
  const reader=body.getReader();
  const decoder=new TextDecoder();
  let buffer='';
  try {
    while (true) {
      const {done,value}=await reader.read();
      buffer += decoder.decode(value || new Uint8Array(),{stream:!done});
      let match;
      while ((match=buffer.match(/\r?\n\r?\n/))) {
        const index=match.index;
        const block=buffer.slice(0,index);
        buffer=buffer.slice(index+match[0].length);
        const event=parseBlock(block);
        if (event) yield event;
      }
      if (done) break;
    }
    if (buffer.trim()) {
      const event=parseBlock(buffer);
      if (event) yield event;
    }
  } catch (error) {
    if (error instanceof ConnectorContractError) throw error;
    throw new ConnectorContractError('CONNECTION_REQUIRED','Connector event stream disconnected',{recoverable:true,cause:error instanceof Error ? error.message : String(error)});
  } finally {
    reader.releaseLock?.();
  }
}

export class ConnectorJobEventClient {
  constructor({connectorClient}={}) {
    if (!connectorClient?.request) throw new ConnectorContractError('CONNECTOR_JOB_EVENT_CLIENT_INVALID','ConnectorJobEventClient requires ConnectorClient');
    this.connectorClient=connectorClient;
  }

  async open({lastSequence=null}={}) {
    const headers={accept:'text/event-stream'};
    if (lastSequence != null) headers['Last-Event-ID']=String(sequence(lastSequence,'lastSequence'));
    const response=await this.connectorClient.request(CONNECTOR_EVENTS_PATH,{scope:'jobs.read',headers});
    if (!response.ok) throw new ConnectorContractError('CONNECTOR_JOB_EVENT_HTTP_ERROR',`Connector event stream HTTP ${response.status}`,{status:response.status});
    return response;
  }

  async *events({lastSequence=null}={}) {
    const response=await this.open({lastSequence});
    yield* streamSseEvents(response.body);
  }
}
