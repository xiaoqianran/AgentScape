import { ConnectorContractError } from './ConnectorSession.js';
import { GenerationJobStore } from '../jobs/GenerationJobStore.js';
import {
  GenerationJobContractError,
  normalizeGenerationJobProjection,
  requireSafeJobId,
  sanitizeJobData
} from '../jobs/GenerationJobProjection.js';

const JOBS_PATH='/connector/v1/jobs';
const clone=(value)=>value == null ? value : structuredClone(value);
const requireText=(value,field)=>{
  const text=String(value ?? '').trim();
  if (!text) throw new GenerationJobContractError('JOB_REQUEST_INVALID',`Job request requires ${field}`,{field});
  return text;
};


function normalizeEventCursor(value) {
  if (value == null || value === '') return null;
  const n=Number(value);
  if (!Number.isSafeInteger(n) || n < 0) {
    throw new GenerationJobContractError('JOB_EVENT_SEQUENCE_INVALID','Connector event cursor must be a non-negative safe integer');
  }
  return n;
}

async function readJson(response) {
  const payload=await response.json().catch(()=>null);
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new ConnectorContractError('CONNECTOR_JOB_RESPONSE_INVALID','Connector returned invalid Job JSON');
  }
  return payload;
}

function httpError(payload,status) {
  return new ConnectorContractError(payload.code || 'CONNECTOR_JOB_HTTP_ERROR',payload.message || `Connector HTTP ${status}`,{status});
}

function validateCapability(registry,provider,operation) {
  const descriptor=registry?.getProvider?.(provider);
  const capability=registry?.getCapability?.(operation);
  if (!descriptor || !capability || capability.provider !== provider) {
    throw new GenerationJobContractError('JOB_CAPABILITY_UNAVAILABLE','Requested provider capability is not registered',{provider,operation});
  }
  if (descriptor.status !== 'available' || descriptor.health === 'unavailable' || capability.status !== 'available') {
    throw new GenerationJobContractError('JOB_CAPABILITY_UNAVAILABLE','Requested provider capability is not currently available',{provider,operation});
  }
  if (capability.prerequisites?.authMode !== 'connector-session') {
    throw new GenerationJobContractError('JOB_CAPABILITY_TRANSPORT_INVALID','Connector Job client requires a connector-session capability',{provider,operation});
  }
  const source=registry.getProviderSource?.(provider);
  if (source?.kind !== 'connector' || !source.capabilityHash || !source.capabilityRevision) {
    throw new GenerationJobContractError('JOB_CAPABILITY_STALE','Connector capability provenance is missing',{provider,operation});
  }
  return {descriptor,capability,source};
}

function canonicalSubmitRequest(request,registry) {
  if (!request || typeof request !== 'object' || Array.isArray(request)) throw new GenerationJobContractError('JOB_REQUEST_INVALID','Job submit request must be an object');
  const provider=requireText(request.provider,'provider');
  const operation=requireText(request.operation,'operation');
  const {descriptor,capability,source}=validateCapability(registry,provider,operation);
  const requestedOutputRoles=[...new Set((Array.isArray(request.outputRoles) ? request.outputRoles : []).map(String).filter(Boolean))];
  const allowedOutputRoles=new Set(capability.output?.roles || []);
  const invalidOutputRoles=requestedOutputRoles.filter((role)=>!allowedOutputRoles.has(role));
  if (invalidOutputRoles.length) {
    throw new GenerationJobContractError('JOB_OUTPUT_ROLE_INVALID','Job requested output roles not declared by the capability',{
      provider,operation,invalidOutputRoles
    });
  }
  return {
    provider,
    operation,
    operationVersion:String(capability.version),
    contractVersion:String(descriptor.contractVersion || '1'),
    idempotencyKey:requireText(request.idempotencyKey,'idempotencyKey'),
    requestHash:requireText(request.requestHash,'requestHash'),
    inputs:sanitizeJobData(request.inputs || {},'inputs'),
    profile:request.profile == null ? null : String(request.profile),
    options:sanitizeJobData(request.options || {},'options'),
    outputRoles:requestedOutputRoles,
    parent:request.parent == null ? null : sanitizeJobData(request.parent,'parent'),
    retention:request.retention == null ? null : sanitizeJobData(request.retention,'retention'),
    metadata:request.metadata == null ? null : sanitizeJobData(request.metadata,'metadata'),
    capabilityHash:source.capabilityHash,
    capabilityRevision:source.capabilityRevision
  };
}

function assertResponseMatchesRequest(job,request) {
  for (const field of ['provider','operation','contractVersion','requestHash','idempotencyKey','capabilityHash','capabilityRevision']) {
    if (job[field] !== request[field]) {
      throw new GenerationJobContractError('JOB_RESPONSE_IDENTITY_MISMATCH',`Connector Job response does not match submitted ${field}`,{
        field,expected:request[field],actual:job[field]
      });
    }
  }
}

export class ConnectorJobClient {
  constructor({connectorClient,providerRegistry,store=new GenerationJobStore()}={}) {
    if (!connectorClient?.request) throw new GenerationJobContractError('JOB_CLIENT_INVALID','ConnectorJobClient requires ConnectorClient');
    if (!providerRegistry?.getCapability) throw new GenerationJobContractError('JOB_CLIENT_INVALID','ConnectorJobClient requires ProviderRegistry');
    this.connectorClient=connectorClient;
    this.providerRegistry=providerRegistry;
    this.store=store;
  }

  async submit(request) {
    const body=canonicalSubmitRequest(request,this.providerRegistry);
    const response=await this.connectorClient.request(JOBS_PATH,{
      scope:'jobs.submit',method:'POST',
      headers:{'content-type':'application/json',accept:'application/json'},
      body:JSON.stringify(body)
    });
    const payload=await readJson(response);
    if (!response.ok) throw httpError(payload,response.status);
    const rawJob=payload.job || payload;
    const job=normalizeGenerationJobProjection(rawJob);
    assertResponseMatchesRequest(job,body);
    return this.store.apply(rawJob).job;
  }

  async list({ replaceStore=true } = {}) {
    const response=await this.connectorClient.request(JOBS_PATH,{scope:'jobs.read'});
    const payload=await readJson(response);
    if (!response.ok) throw httpError(payload,response.status);
    if (!Array.isArray(payload.jobs)) {
      throw new ConnectorContractError('CONNECTOR_JOB_RESPONSE_INVALID','Connector Job list requires jobs array');
    }
    const jobs=replaceStore
      ? this.store.replaceAllAtomically(payload.jobs)
      : payload.jobs.map((job)=>normalizeGenerationJobProjection(job));
    return { jobs, eventCursor:normalizeEventCursor(payload.eventCursor) };
  }

  async get(id) {
    const jobId=requireSafeJobId(id);
    const response=await this.connectorClient.request(`${JOBS_PATH}/${jobId}`,{scope:'jobs.read'});
    const payload=await readJson(response);
    if (!response.ok) throw httpError(payload,response.status);
    const rawJob=payload.job || payload;
    if (requireSafeJobId(rawJob.id) !== jobId) {
      throw new GenerationJobContractError('JOB_RESPONSE_IDENTITY_MISMATCH','Connector Job response ID does not match the requested Job',{expected:jobId,actual:rawJob.id});
    }
    return this.store.apply(rawJob).job;
  }

  async cancel(id) {
    const jobId=requireSafeJobId(id);
    const response=await this.connectorClient.request(`${JOBS_PATH}/${jobId}/cancel`,{
      scope:'jobs.cancel',method:'POST',headers:{accept:'application/json'}
    });
    const payload=await readJson(response);
    if (!response.ok) throw httpError(payload,response.status);
    const rawJob=payload.job || payload;
    if (requireSafeJobId(rawJob.id) !== jobId) {
      throw new GenerationJobContractError('JOB_RESPONSE_IDENTITY_MISMATCH','Connector Job response ID does not match the requested Job',{expected:jobId,actual:rawJob.id});
    }
    return this.store.apply(rawJob).job;
  }

  getCached(id) { return this.store.get(id); }
  listCached() { return this.store.list(); }
  buildSubmitRequest(request) { return clone(canonicalSubmitRequest(request,this.providerRegistry)); }
}
