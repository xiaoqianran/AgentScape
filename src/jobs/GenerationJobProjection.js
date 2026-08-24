const CONNECTOR_STATUSES = new Set([
  'accepted','queued','running','connection_required','cancel_requested',
  'cancelled','failed','expired','succeeded'
]);
const TERMINAL_CONNECTOR_STATUSES = new Set(['cancelled','failed','expired','succeeded']);
const PHASE_BY_STATUS = Object.freeze({
  accepted:'pending', queued:'pending', running:'pending',
  connection_required:'recoverable',
  cancel_requested:'cancelling',
  cancelled:'terminal_non_success', failed:'terminal_non_success', expired:'terminal_non_success',
  succeeded:'result_available'
});
const RELATION_TYPES = new Set(['parent','child','retry_of','fallback_of']);
const SAFE_JOB_ID = /^[A-Za-z0-9_-]{1,160}$/;
const SECRET_KEY = /(authorization|api[-_]?key|access[-_]?token|refresh[-_]?token|secret|credential|signed[-_]?url)/i;
const clone = (value) => value == null ? value : structuredClone(value);

export class GenerationJobContractError extends Error {
  constructor(code,message,details={}) {
    super(message);
    this.name='GenerationJobContractError';
    this.code=code;
    this.details=clone(details);
  }
}

const requireText=(value,field)=>{
  const text=String(value ?? '').trim();
  if (!text) throw new GenerationJobContractError('JOB_PROJECTION_INVALID',`Job projection requires ${field}`,{field});
  return text;
};
const optionalText=(value)=>value == null || value === '' ? null : String(value).trim();

export function requireSafeJobId(value,field='id') {
  const id=requireText(value,field);
  if (!SAFE_JOB_ID.test(id)) throw new GenerationJobContractError('JOB_ID_INVALID','Connector Job ID must be a URL-safe opaque identifier',{field});
  return id;
}

function safeData(value,path='value') {
  if (value == null || ['string','number','boolean'].includes(typeof value)) return value;
  if (Array.isArray(value)) return value.map((item,index)=>safeData(item,`${path}[${index}]`));
  if (typeof value !== 'object' || Object.getPrototypeOf(value)!==Object.prototype) {
    throw new GenerationJobContractError('JOB_DATA_INVALID','Job data must contain JSON-compatible values',{path});
  }
  const out={};
  for (const [key,item] of Object.entries(value)) {
    if (SECRET_KEY.test(key)) throw new GenerationJobContractError('JOB_SECRET_FIELD','Job projection/request contains a secret-like field',{path:`${path}.${key}`});
    out[key]=safeData(item,`${path}.${key}`);
  }
  return out;
}
export const sanitizeJobData=(value,path)=>clone(safeData(value,path));

function normalizeTime(value,field,{required=false}={}) {
  if (value == null || value === '') {
    if (required) throw new GenerationJobContractError('JOB_PROJECTION_INVALID',`Job projection requires ${field}`,{field});
    return null;
  }
  const time=Date.parse(String(value));
  if (!Number.isFinite(time)) throw new GenerationJobContractError('JOB_PROJECTION_INVALID',`Job projection has invalid ${field}`,{field});
  return new Date(time).toISOString();
}

function normalizeProgress(progress) {
  if (progress == null) return null;
  if (!progress || typeof progress !== 'object' || Array.isArray(progress)) {
    throw new GenerationJobContractError('JOB_PROJECTION_INVALID','Job progress must be a semantic object');
  }
  const out={};
  for (const key of ['kind','current','total','unit','label']) {
    if (progress[key] != null) out[key]=safeData(progress[key],`progress.${key}`);
  }
  return out;
}

function normalizeVersionedRef(value,field) {
  if (value == null) return null;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new GenerationJobContractError('JOB_PROJECTION_INVALID',`Job ${field} must be a structured versioned reference`);
  }
  return {
    id:optionalText(value.id),
    version:optionalText(value.version),
    revision:optionalText(value.revision)
  };
}

function normalizeError(error) {
  if (error == null) return null;
  if (!error || typeof error !== 'object' || Array.isArray(error)) {
    throw new GenerationJobContractError('JOB_PROJECTION_INVALID','Job error must be a structured object');
  }
  return {
    code:requireText(error.code,'error.code'),
    message:optionalText(error.message),
    recoverable:Boolean(error.recoverable)
  };
}

function normalizeArtifactSummary(artifact) {
  if (!artifact || typeof artifact !== 'object' || Array.isArray(artifact)) {
    throw new GenerationJobContractError('JOB_PROJECTION_INVALID','Job artifact summary must be an object');
  }
  const bytes=artifact.bytes == null ? null : Number(artifact.bytes);
  if (bytes != null && (!Number.isSafeInteger(bytes) || bytes < 0)) {
    throw new GenerationJobContractError('JOB_PROJECTION_INVALID','Job artifact bytes must be a non-negative safe integer');
  }
  return {
    id:requireText(artifact.id,'result.artifacts[].id'),
    role:requireText(artifact.role,'result.artifacts[].role'),
    mime:optionalText(artifact.mime),
    bytes,
    hash:optionalText(artifact.hash)
  };
}

function normalizeResult(result) {
  if (result == null) return null;
  if (!result || typeof result !== 'object' || Array.isArray(result)) {
    throw new GenerationJobContractError('JOB_PROJECTION_INVALID','Job result must be a safe summary object');
  }
  return {
    manifestId:optionalText(result.manifestId),
    artifacts:Array.isArray(result.artifacts) ? result.artifacts.map(normalizeArtifactSummary) : []
  };
}

function normalizeRelations(relations=[]) {
  if (!Array.isArray(relations)) throw new GenerationJobContractError('JOB_PROJECTION_INVALID','Job relations must be an array');
  return relations.map((relation)=>{
    if (!relation || typeof relation !== 'object' || Array.isArray(relation)) throw new GenerationJobContractError('JOB_PROJECTION_INVALID','Job relation must be an object');
    const type=requireText(relation.type,'relations[].type');
    if (!RELATION_TYPES.has(type)) throw new GenerationJobContractError('JOB_PROJECTION_INVALID',`Unsupported Job relation type: ${type}`);
    return {type,jobId:requireSafeJobId(relation.jobId,'relations[].jobId')};
  });
}

function normalizeSequence(value) {
  const n=Number(value);
  if (!Number.isSafeInteger(n) || n < 0) throw new GenerationJobContractError('JOB_EVENT_SEQUENCE_INVALID','Job eventSequence must be a non-negative safe integer');
  return n;
}

export function normalizeGenerationJobProjection(payload={}) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new GenerationJobContractError('JOB_PROJECTION_INVALID','Job projection must be an object');
  const id=requireSafeJobId(payload.id);
  const provider=requireText(payload.provider,'provider');
  const operation=requireText(payload.operation,'operation');
  if (!operation.startsWith(`${provider}.`) || !/\.v\d+$/.test(operation)) {
    throw new GenerationJobContractError('JOB_PROJECTION_INVALID','Job operation must be a stable provider-scoped operation ID',{provider,operation});
  }
  const status=requireText(payload.status,'status');
  if (!CONNECTOR_STATUSES.has(status)) throw new GenerationJobContractError('JOB_STATUS_UNKNOWN',`Unknown Connector Job status: ${status}`);
  const attempt=payload.attempt == null ? 1 : Number(payload.attempt);
  if (!Number.isSafeInteger(attempt) || attempt < 1) throw new GenerationJobContractError('JOB_PROJECTION_INVALID','Job attempt must be a positive integer');
  const createdAt=normalizeTime(payload.createdAt,'createdAt',{required:true});
  const updatedAt=normalizeTime(payload.updatedAt,'updatedAt',{required:true});
  const result=normalizeResult(payload.result);
  return {
    id,
    provider,
    operation,
    kind:String(payload.kind || 'generation'),
    requestHash:requireText(payload.requestHash,'requestHash'),
    idempotencyKey:requireText(payload.idempotencyKey,'idempotencyKey'),
    contractVersion:requireText(payload.contractVersion,'contractVersion'),
    capabilityHash:requireText(payload.capabilityHash,'capabilityHash'),
    capabilityRevision:requireText(payload.capabilityRevision,'capabilityRevision'),
    status,
    phase:PHASE_BY_STATUS[status],
    stage:optionalText(payload.stage),
    progress:normalizeProgress(payload.progress),
    attempt,
    relations:normalizeRelations(payload.relations || []),
    effectiveOptions:sanitizeJobData(payload.effectiveOptions || {},'effectiveOptions'),
    model:normalizeVersionedRef(payload.model,'model'),
    workflow:normalizeVersionedRef(payload.workflow,'workflow'),
    createdAt,
    submittedAt:normalizeTime(payload.submittedAt,'submittedAt'),
    startedAt:normalizeTime(payload.startedAt,'startedAt'),
    updatedAt,
    completedAt:normalizeTime(payload.completedAt,'completedAt'),
    error:normalizeError(payload.error),
    result,
    lastEventSequence:normalizeSequence(payload.eventSequence)
  };
}

export function jobFactSignature(job) {
  return JSON.stringify({
    status:job.status,
    phase:job.phase,
    stage:job.stage,
    progress:job.progress,
    attempt:job.attempt,
    relations:job.relations,
    effectiveOptions:job.effectiveOptions,
    model:job.model,
    workflow:job.workflow,
    submittedAt:job.submittedAt,
    startedAt:job.startedAt,
    updatedAt:job.updatedAt,
    completedAt:job.completedAt,
    error:job.error,
    result:job.result
  });
}

export function assertJobIdentityCompatible(previous,next) {
  for (const field of ['id','provider','operation','kind','requestHash','idempotencyKey','contractVersion','capabilityHash','capabilityRevision']) {
    if (previous[field] !== next[field]) {
      throw new GenerationJobContractError('JOB_IDENTITY_CONFLICT',`Job immutable identity changed: ${field}`,{
        field,before:previous[field],after:next[field]
      });
    }
  }
}

export function assertJobTransition(previousStatus,nextStatus) {
  if (previousStatus === nextStatus) return true;
  if (TERMINAL_CONNECTOR_STATUSES.has(previousStatus)) {
    throw new GenerationJobContractError('JOB_STATUS_REGRESSION',`Terminal Connector Job cannot transition ${previousStatus} -> ${nextStatus}`);
  }
  const allowed={
    accepted:new Set(['queued','running','connection_required','cancel_requested','succeeded','failed','cancelled','expired']),
    queued:new Set(['running','connection_required','cancel_requested','succeeded','failed','cancelled','expired']),
    running:new Set(['connection_required','cancel_requested','succeeded','failed','cancelled','expired']),
    connection_required:new Set(['accepted','queued','running','cancel_requested','succeeded','failed','cancelled','expired']),
    cancel_requested:new Set(['connection_required','succeeded','failed','cancelled','expired'])
  };
  if (!allowed[previousStatus]?.has(nextStatus)) {
    throw new GenerationJobContractError('JOB_STATUS_REGRESSION',`Invalid Connector Job transition ${previousStatus} -> ${nextStatus}`);
  }
  return true;
}

export const connectorJobPhase=(status)=>PHASE_BY_STATUS[status] || null;
export const connectorJobStatusIsRemoteTerminal=(status)=>TERMINAL_CONNECTOR_STATUSES.has(status);
