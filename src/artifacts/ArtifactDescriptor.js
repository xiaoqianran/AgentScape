const HASH_RE=/^sha256:[0-9a-f]{64}$/;
const SAFE_ID=/^[A-Za-z0-9_-]{1,160}$/;
const SAFE_SLUG=/^[a-z0-9][a-z0-9._-]{0,95}$/i;
const SAFE_SCHEMA_ID=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const MIME_RE=/^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/i;
const CONTROL_RE=/[\u0000-\u001f\u007f]/;
const UNSAFE_TEXT_RE=/https?:\/\/|Bearer\s+|(?:^|\s)(?:[A-Za-z]:\\|\/)[^\s]+/i;
const FORBIDDEN_KEY=/(authorization|api[-_]?key|access[-_]?token|refresh[-_]?token|secret|credential|signed[-_]?url|volume[-_]?path|file[-_]?path|(^|[_-])path($|[_-])|(^|[_-])url($|[_-])|traceback|stack|prompt|image[-_]?bytes|base64|remote[-_]?.*id|function[-_]?call[-_]?id)/i;

export const ARTIFACT_INTEGRITY_STATES=Object.freeze(['declared','verified','rejected']);
export const ARTIFACT_LOCATION_KINDS=Object.freeze(['connector','local-cache','compiled-store','legacy']);
export const ARTIFACT_LOCATION_SCOPES=Object.freeze(['session','job','project','application']);
export const ARTIFACT_LOCATION_STATES=Object.freeze(['available','unavailable','expired','evicted']);
export const ARTIFACT_RETENTION_CLASSES=Object.freeze(['ephemeral','session','project','favorite','persistent']);
export const ARTIFACT_LINEAGE_RELATIONS=Object.freeze(['derived_from','input','preview_of','compiled_from']);
export const ARTIFACT_LEASE_HOLDER_KINDS=Object.freeze(['job','project','viewer','transfer','favorite','application']);

const LOCATION_KIND_SET=new Set(ARTIFACT_LOCATION_KINDS);
const LOCATION_SCOPE_SET=new Set(ARTIFACT_LOCATION_SCOPES);
const LOCATION_STATE_SET=new Set(ARTIFACT_LOCATION_STATES);
const RETENTION_SET=new Set(ARTIFACT_RETENTION_CLASSES);
const LINEAGE_RELATION_SET=new Set(ARTIFACT_LINEAGE_RELATIONS);

const clone=(value)=>value == null ? value : structuredClone(value);

export class ArtifactContractError extends Error {
  constructor(code,message,details={}) {
    super(message);
    this.name='ArtifactContractError';
    this.code=code;
    this.details=clone(details);
  }
}

const requiredText=(value,field,max=200)=>{
  const text=String(value ?? '').trim();
  if (!text) throw new ArtifactContractError('ARTIFACT_DESCRIPTOR_INVALID',`Artifact descriptor requires ${field}`,{field});
  if (text.length>max || CONTROL_RE.test(text)) throw new ArtifactContractError('ARTIFACT_DESCRIPTOR_INVALID',`Artifact descriptor has invalid ${field}`,{field});
  return text;
};
const optionalText=(value,field,max=200)=>value==null||value===''?null:requiredText(value,field,max);

const safeUiText=(value,field,max=200)=>{
  const text=requiredText(value,field,max);
  if (UNSAFE_TEXT_RE.test(text)) throw new ArtifactContractError('ARTIFACT_FORBIDDEN_VALUE',`Artifact ${field} contains unsafe transport/path text`,{field});
  return text;
};
const optionalSafeUiText=(value,field,max=200)=>value==null||value===''?null:safeUiText(value,field,max);

export function requireSafeArtifactId(value,field='id') {
  const id=String(value ?? '').trim();
  if (!id || id.length>160 || CONTROL_RE.test(id) || !SAFE_ID.test(id)) {
    throw new ArtifactContractError('ARTIFACT_ID_INVALID','Artifact ID must be an opaque URL-safe identifier',{field});
  }
  return id;
}

export function normalizeArtifactHash(value,field='hash') {
  const hash=requiredText(value,field,80);
  if (!HASH_RE.test(hash)) throw new ArtifactContractError('ARTIFACT_HASH_INVALID','Artifact hash must be canonical sha256:<64 lowercase hex>',{field});
  return hash;
}

function assertNoForbiddenFields(value,path='artifact') {
  if (!value || typeof value!=='object') return;
  if (Array.isArray(value)) {
    value.forEach((item,index)=>assertNoForbiddenFields(item,`${path}[${index}]`));
    return;
  }
  for (const [key,item] of Object.entries(value)) {
    if (FORBIDDEN_KEY.test(key)) {
      throw new ArtifactContractError('ARTIFACT_FORBIDDEN_FIELD','Artifact descriptor contains a forbidden trust-boundary field',{path:`${path}.${key}`});
    }
    assertNoForbiddenFields(item,`${path}.${key}`);
  }
}

function normalizeTime(value,field,{required=false}={}) {
  if (value==null||value==='') {
    if (required) throw new ArtifactContractError('ARTIFACT_DESCRIPTOR_INVALID',`Artifact descriptor requires ${field}`,{field});
    return null;
  }
  const time=Date.parse(String(value));
  if (!Number.isFinite(time)) throw new ArtifactContractError('ARTIFACT_DESCRIPTOR_INVALID',`Artifact descriptor has invalid ${field}`,{field});
  return new Date(time).toISOString();
}

function normalizeVersionedRef(value,field) {
  if (value==null) return null;
  if (!value || typeof value!=='object' || Array.isArray(value)) throw new ArtifactContractError('ARTIFACT_DESCRIPTOR_INVALID',`Artifact ${field} must be a versioned reference`);
  return {
    id:optionalText(value.id,`${field}.id`,120),
    version:optionalText(value.version,`${field}.version`,80),
    revision:optionalText(value.revision,`${field}.revision`,120)
  };
}

function normalizeProducer(value={}) {
  if (!value || typeof value!=='object' || Array.isArray(value)) throw new ArtifactContractError('ARTIFACT_DESCRIPTOR_INVALID','Artifact producer must be an object');
  const provider=requiredText(value.provider,'producer.provider',120);
  const operation=requiredText(value.operation,'producer.operation',180);
  if (!operation.startsWith(`${provider}.`) || !/\.v\d+$/.test(operation)) {
    throw new ArtifactContractError('ARTIFACT_DESCRIPTOR_INVALID','Artifact producer operation must be a stable provider-scoped operation ID',{provider,operation});
  }
  const attempt=Number(value.attempt ?? 1);
  if (!Number.isSafeInteger(attempt)||attempt<1) throw new ArtifactContractError('ARTIFACT_DESCRIPTOR_INVALID','Artifact producer attempt must be a positive integer');
  const stage=optionalText(value.stage,'producer.stage',100);
  if (stage && !SAFE_SLUG.test(stage)) throw new ArtifactContractError('ARTIFACT_DESCRIPTOR_INVALID','Artifact producer stage must be a stable slug');
  return {
    jobId:requireSafeArtifactId(value.jobId,'producer.jobId'),
    provider,
    operation,
    stage,
    attempt,
    revision:optionalText(value.revision,'producer.revision',120),
    model:normalizeVersionedRef(value.model,'producer.model'),
    workflow:normalizeVersionedRef(value.workflow,'producer.workflow')
  };
}

function normalizeLineage(value={},selfId) {
  if (value==null) return {parents:[]};
  if (!value || typeof value!=='object' || Array.isArray(value)) throw new ArtifactContractError('ARTIFACT_DESCRIPTOR_INVALID','Artifact lineage must be an object');
  const parents=Array.isArray(value.parents)?value.parents:[];
  const seen=new Set();
  const normalized=parents.map((parent)=>{
    if (!parent || typeof parent!=='object' || Array.isArray(parent)) throw new ArtifactContractError('ARTIFACT_DESCRIPTOR_INVALID','Artifact lineage parent must be an object');
    const artifactId=requireSafeArtifactId(parent.artifactId,'lineage.parents[].artifactId');
    if (artifactId===selfId) throw new ArtifactContractError('ARTIFACT_LINEAGE_INVALID','Artifact cannot derive from itself',{artifactId});
    const relation=requiredText(parent.relation,'lineage.parents[].relation',64);
    if (!LINEAGE_RELATION_SET.has(relation)) throw new ArtifactContractError('ARTIFACT_LINEAGE_INVALID',`Unsupported artifact lineage relation: ${relation}`);
    const key=`${artifactId}:${relation}`;
    if (seen.has(key)) throw new ArtifactContractError('ARTIFACT_LINEAGE_INVALID','Duplicate artifact lineage edge',{artifactId,relation});
    seen.add(key);
    return {artifactId,hash:normalizeArtifactHash(parent.hash,'lineage.parents[].hash'),relation};
  });
  return {parents:normalized};
}

function normalizeAccess(value,locationKind,artifactId) {
  if (value==null) return null;
  if (!value || typeof value!=='object' || Array.isArray(value)) throw new ArtifactContractError('ARTIFACT_LOCATION_INVALID','Artifact location access must be an object');
  const kind=requiredText(value.kind,'locations[].access.kind',80);
  if (locationKind==='connector') {
    if (kind!=='connector-artifact') throw new ArtifactContractError('ARTIFACT_LOCATION_INVALID','Connector location must use connector-artifact access');
    const accessArtifactId=requireSafeArtifactId(value.artifactId,'locations[].access.artifactId');
    if (accessArtifactId!==artifactId) throw new ArtifactContractError('ARTIFACT_LOCATION_INVALID','Connector access artifactId must match descriptor identity');
    return {kind,artifactId:accessArtifactId};
  }
  if (locationKind==='local-cache') {
    if (kind!=='cache-key') throw new ArtifactContractError('ARTIFACT_LOCATION_INVALID','Local cache location must use cache-key access');
    return {kind,key:requireSafeArtifactId(value.key,'locations[].access.key')};
  }
  if (locationKind==='compiled-store') {
    if (kind!=='compiled-key') throw new ArtifactContractError('ARTIFACT_LOCATION_INVALID','Compiled location must use compiled-key access');
    return {kind,key:requireSafeArtifactId(value.key,'locations[].access.key')};
  }
  if (value) throw new ArtifactContractError('ARTIFACT_LOCATION_INVALID','Legacy location access is intentionally opaque and unavailable to browser code');
  return null;
}

export function normalizeArtifactLocation(value={},artifactId) {
  assertNoForbiddenFields(value,'location');
  if (!value || typeof value!=='object' || Array.isArray(value)) throw new ArtifactContractError('ARTIFACT_LOCATION_INVALID','Artifact location must be an object');
  const kind=requiredText(value.kind,'locations[].kind',64);
  const scope=requiredText(value.scope,'locations[].scope',64);
  const state=requiredText(value.state,'locations[].state',64);
  if (!LOCATION_KIND_SET.has(kind)) throw new ArtifactContractError('ARTIFACT_LOCATION_INVALID',`Unsupported artifact location kind: ${kind}`);
  if (!LOCATION_SCOPE_SET.has(scope)) throw new ArtifactContractError('ARTIFACT_LOCATION_INVALID',`Unsupported artifact location scope: ${scope}`);
  if (!LOCATION_STATE_SET.has(state)) throw new ArtifactContractError('ARTIFACT_LOCATION_INVALID',`Unsupported artifact location state: ${state}`);
  const verifiedAt=normalizeTime(value.verifiedAt,'locations[].verifiedAt');
  const expiresAt=normalizeTime(value.expiresAt,'locations[].expiresAt');
  if (verifiedAt && expiresAt && Date.parse(expiresAt)<Date.parse(verifiedAt)) throw new ArtifactContractError('ARTIFACT_LOCATION_INVALID','Artifact location expires before it was verified');
  const access=normalizeAccess(value.access,kind,artifactId);
  if (state==='available' && kind!=='legacy' && !access) {
    throw new ArtifactContractError('ARTIFACT_LOCATION_INVALID','Available artifact location requires a safe access handle',{kind});
  }
  return {
    id:requireSafeArtifactId(value.id,'locations[].id'),
    kind,
    scope,
    state,
    verifiedAt,
    expiresAt,
    access
  };
}

function normalizeRetention(value={}) {
  if (value==null) value={};
  if (!value || typeof value!=='object' || Array.isArray(value)) throw new ArtifactContractError('ARTIFACT_DESCRIPTOR_INVALID','Artifact retention must be an object');
  const retentionClass=String(value.class || 'ephemeral');
  if (!RETENTION_SET.has(retentionClass)) throw new ArtifactContractError('ARTIFACT_DESCRIPTOR_INVALID',`Unsupported artifact retention class: ${retentionClass}`);
  return {
    class:retentionClass,
    expiresAt:normalizeTime(value.expiresAt,'retention.expiresAt')
  };
}

function normalizeWarnings(value=[]) {
  if (!Array.isArray(value)) throw new ArtifactContractError('ARTIFACT_DESCRIPTOR_INVALID','Artifact warnings must be an array');
  return [...new Set(value.map((warning,index)=>safeUiText(warning,`warnings[${index}]`,240)))];
}

function normalizeSchema(value={}) {
  if (!value || typeof value!=='object' || Array.isArray(value)) throw new ArtifactContractError('ARTIFACT_DESCRIPTOR_INVALID','Artifact schema must be an object');
  const id=requiredText(value.id,'schema.id',128);
  if (!SAFE_SCHEMA_ID.test(id)) throw new ArtifactContractError('ARTIFACT_DESCRIPTOR_INVALID','Artifact schema id is invalid');
  return {id,version:requiredText(value.version,'schema.version',64)};
}

export function normalizeArtifactDescriptor(payload={}) {
  if (!payload || typeof payload!=='object' || Array.isArray(payload)) throw new ArtifactContractError('ARTIFACT_DESCRIPTOR_INVALID','Artifact descriptor must be an object');
  assertNoForbiddenFields(payload);
  const id=requireSafeArtifactId(payload.id);
  const role=requiredText(payload.role,'role',96);
  const type=requiredText(payload.type,'type',96);
  const format=requiredText(payload.format,'format',64);
  if (!SAFE_SLUG.test(role)||!SAFE_SLUG.test(type)||!SAFE_SLUG.test(format)) throw new ArtifactContractError('ARTIFACT_DESCRIPTOR_INVALID','Artifact role/type/format must use stable slugs');
  const mime=requiredText(payload.mime,'mime',120).toLowerCase();
  if (!MIME_RE.test(mime)) throw new ArtifactContractError('ARTIFACT_DESCRIPTOR_INVALID','Artifact MIME is invalid');
  const bytes=Number(payload.bytes);
  if (!Number.isSafeInteger(bytes)||bytes<0) throw new ArtifactContractError('ARTIFACT_BYTES_INVALID','Artifact bytes must be a non-negative safe integer');
  const createdAt=normalizeTime(payload.createdAt,'createdAt',{required:true});
  const expiresAt=normalizeTime(payload.expiresAt,'expiresAt');
  if (expiresAt && Date.parse(expiresAt)<Date.parse(createdAt)) throw new ArtifactContractError('ARTIFACT_DESCRIPTOR_INVALID','Artifact expires before it was created');
  if (payload.integrity?.state && payload.integrity.state!=='declared') {
    throw new ArtifactContractError('ARTIFACT_INTEGRITY_EVIDENCE_REQUIRED','Untrusted descriptor cannot self-promote integrity beyond declared');
  }
  const locations=Array.isArray(payload.locations)?payload.locations.map((location)=>normalizeArtifactLocation(location,id)):[];
  const locationIds=new Set();
  for (const location of locations) {
    if (locationIds.has(location.id)) throw new ArtifactContractError('ARTIFACT_LOCATION_INVALID','Duplicate artifact location ID',{locationId:location.id});
    locationIds.add(location.id);
  }
  return {
    id,
    role,
    type,
    schema:normalizeSchema(payload.schema),
    displayName:optionalSafeUiText(payload.displayName,'displayName',160),
    mime,
    format,
    bytes,
    hash:normalizeArtifactHash(payload.hash),
    producer:normalizeProducer(payload.producer),
    lineage:normalizeLineage(payload.lineage,id),
    createdAt,
    expiresAt,
    integrity:{state:'declared',verifiedAt:null,method:null,rejection:null},
    warnings:normalizeWarnings(payload.warnings || []),
    retention:(()=>{
      const retention=normalizeRetention(payload.retention);
      if (retention.expiresAt && Date.parse(retention.expiresAt)<Date.parse(createdAt)) {
        throw new ArtifactContractError('ARTIFACT_DESCRIPTOR_INVALID','Artifact retention expires before artifact creation');
      }
      return retention;
    })(),
    locations
  };
}

export function artifactImmutableSignature(descriptor) {
  return JSON.stringify({
    id:descriptor.id,role:descriptor.role,type:descriptor.type,schema:descriptor.schema,
    mime:descriptor.mime,format:descriptor.format,bytes:descriptor.bytes,hash:descriptor.hash,
    producer:descriptor.producer,lineage:descriptor.lineage,createdAt:descriptor.createdAt
  });
}
