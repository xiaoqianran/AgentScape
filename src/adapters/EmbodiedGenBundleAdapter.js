const HEX_SHA256 = /^[0-9a-f]{64}$/i;
const JOB_ID = /^job-[0-9a-f]{32}$/;
const SAFE_LINEAGE_KEYS = new Set(['providerCommit','modalBuildCommit','embodiedGenCommit','workflow','workflowVersion','modelRevision','seed']);

const safeRelativeRef = (value, label) => {
  if (value == null) return undefined;
  const text=String(value).trim();
  const segments=text.split('/');
  if (!text || text.length > 512 || text.includes('://') || text.includes('?') || text.includes('#') || text.startsWith('/') || text.includes('\\') || segments.includes('..')) {
    fail('EMBODIEDGEN_ARTIFACT_REFERENCE_INVALID', `${label} must be a bounded relative reference without URL/query data.`);
  }
  return text;
};

const safeLineage = (value) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const out={};
  for (const [key,item] of Object.entries(value)) {
    if (!SAFE_LINEAGE_KEYS.has(key)) continue;
    if (typeof item === 'string' && item.length <= 256 && !/https?:\/\//i.test(item)) out[key]=item;
    else if (typeof item === 'number' && Number.isFinite(item)) out[key]=item;
    else if (typeof item === 'boolean') out[key]=item;
  }
  return Object.keys(out).length ? out : null;
};

const fail = (code, message, details = undefined) => {
  const error = new Error(message);
  error.code = code;
  if (details !== undefined) error.details = details;
  throw error;
};

const normalizeBytes = (value, label) => {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  fail('EMBODIEDGEN_ARTIFACT_BYTES_MISSING', `Missing bytes for ${label}.`);
};

const sha256Hex = async (bytes) => {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) fail('EMBODIEDGEN_CRYPTO_UNAVAILABLE', 'WebCrypto SHA-256 is unavailable.');
  const digest = new Uint8Array(await subtle.digest('SHA-256', bytes));
  return Array.from(digest, (value) => value.toString(16).padStart(2, '0')).join('');
};

const artifactBytesFor = (artifactBytes, descriptor) => {
  if (artifactBytes instanceof Map) return artifactBytes.get(descriptor.id) ?? artifactBytes.get(descriptor.role);
  if (artifactBytes && typeof artifactBytes === 'object') return artifactBytes[descriptor.id] ?? artifactBytes[descriptor.role];
  return undefined;
};

const assertDescriptor = (descriptor, seenIds, seenRoles) => {
  if (!descriptor || typeof descriptor !== 'object') fail('EMBODIEDGEN_ARTIFACT_DESCRIPTOR_INVALID', 'Artifact descriptor must be an object.');
  const id = String(descriptor.id || '').trim();
  const role = String(descriptor.role || '').trim();
  const mediaType = String(descriptor.mediaType || descriptor.mime || '').trim().toLowerCase();
  const sha256 = String(descriptor.sha256 || '').trim().toLowerCase();
  if (!id || !role || !mediaType || !HEX_SHA256.test(sha256)) {
    fail('EMBODIEDGEN_ARTIFACT_DESCRIPTOR_INVALID', 'Artifact descriptor requires id, role, mediaType and SHA-256.', { id:id || null, role:role || null });
  }
  if (seenIds.has(id)) fail('EMBODIEDGEN_ARTIFACT_ID_DUPLICATE', `Duplicate artifact id: ${id}`);
  if (seenRoles.has(role)) fail('EMBODIEDGEN_ARTIFACT_ROLE_DUPLICATE', `Duplicate artifact role: ${role}`);
  seenIds.add(id); seenRoles.add(role);
  return {
    id, role, mediaType, sha256,
    ...(descriptor.fileName ? { fileName:safeRelativeRef(descriptor.fileName, `${id}.fileName`) } : {}),
    ...(descriptor.path ? { path:safeRelativeRef(descriptor.path, `${id}.path`) } : {}),
    ...(Number.isInteger(descriptor.bytes) && descriptor.bytes >= 0 ? { bytes:descriptor.bytes } : {})
  };
};

const assertHash = async (descriptor, bytes) => {
  if (Number.isInteger(descriptor.bytes) && descriptor.bytes !== bytes.byteLength) {
    fail('EMBODIEDGEN_ARTIFACT_SIZE_MISMATCH', `Artifact byte size mismatch for ${descriptor.id}.`, { expected:descriptor.bytes, actual:bytes.byteLength });
  }
  const actual = await sha256Hex(bytes);
  if (actual !== descriptor.sha256) {
    fail('EMBODIEDGEN_ARTIFACT_HASH_MISMATCH', `Artifact SHA-256 mismatch for ${descriptor.id}.`, { expected:descriptor.sha256, actual });
  }
  return actual;
};

const parseJsonArtifact = (descriptor, bytes) => {
  if (!['application/json', 'application/vnd.agentscape.part-segmentation+json'].includes(descriptor.mediaType)) {
    fail('EMBODIEDGEN_ARTIFACT_MEDIA_TYPE_INVALID', `Unsupported JSON artifact media type for ${descriptor.role}: ${descriptor.mediaType}`);
  }
  try { return JSON.parse(new TextDecoder().decode(bytes)); }
  catch (error) { fail('EMBODIEDGEN_ARTIFACT_JSON_INVALID', `Invalid JSON artifact for ${descriptor.role}: ${error.message}`); }
};

const validateSegmentation = (evidence, primary) => {
  if (!evidence || evidence.version !== 1 || !evidence.source || !Number.isInteger(evidence.faceCount) || evidence.faceCount <= 0 || !Array.isArray(evidence.segments)) {
    fail('EMBODIEDGEN_SEGMENTATION_INVALID', 'Part segmentation must be Segmentation Evidence v1.');
  }
  const boundSha = String(evidence.artifact?.sha256 || '').toLowerCase();
  if (!HEX_SHA256.test(boundSha) || boundSha !== primary.sha256) {
    fail('EMBODIEDGEN_SEGMENTATION_GLB_MISMATCH', 'Part segmentation is not bound to the primary GLB SHA-256.', { primarySha256:primary.sha256, segmentationGlbSha256:boundSha || null });
  }
  const materialization = evidence.materialization;
  if (!materialization?.sourceNode || !Array.isArray(materialization.primitives) || !materialization.primitives.length) {
    fail('EMBODIEDGEN_SEGMENTATION_MATERIALIZATION_INVALID', 'Part segmentation requires sourceNode and primitive face labels.');
  }
  for (const entry of materialization.primitives) {
    if (!Number.isInteger(entry?.primitive) || entry.primitive < 0 || !Array.isArray(entry.faceLabels) || !entry.faceLabels.length) {
      fail('EMBODIEDGEN_SEGMENTATION_MATERIALIZATION_INVALID', 'Each segmentation primitive requires primitive>=0 and non-empty faceLabels[].');
    }
  }
};


const URDF_PROPOSAL_MAX_PARTS = 128;
const URDF_MAX_BYTES = 5 * 1024 * 1024;
const URDF_JOINT_TYPES = new Set(['revolute','prismatic','continuous']);
const URDF_PART_ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$/;
const FORBIDDEN_URDF_KEYS = /(actions?|physics|targets?|motor|authorization|api[-_]?key|token|secret|credential|signed[-_]?url|(^|[_-])url($|[_-])|(^|[_-])path($|[_-])|prompt|pose|remote.*id|function.*id)/i;

const safeEvidenceText = (value, label, { allowRoot = false } = {}) => {
  const text=String(value ?? '').trim();
  if (allowRoot && text === '$root') return text;
  if (!text || text.length > 160 || /[\u0000-\u001f\u007f]/.test(text) || /https?:\/\/|Bearer\s+/i.test(text)) {
    fail('EMBODIEDGEN_URDF_PROPOSAL_INVALID', `${label} must be bounded safe text.`);
  }
  return text;
};

const finiteVector = (value, length, label) => {
  if (!Array.isArray(value) || value.length !== length || !value.every(Number.isFinite)) {
    fail('EMBODIEDGEN_URDF_PROPOSAL_INVALID', `${label} requires finite [${length}].`);
  }
  return value.map(Number);
};

const finiteMatrix4 = (value, label) => {
  if (!Array.isArray(value) || value.length !== 4 || value.some((row) => !Array.isArray(row) || row.length !== 4 || !row.every(Number.isFinite))) {
    fail('EMBODIEDGEN_URDF_PROPOSAL_INVALID', `${label} requires finite 4x4 matrix.`);
  }
  return value.map((row) => row.map(Number));
};

const rejectForbiddenUrdfFields = (value, path = 'partProposal') => {
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    value.forEach((item,index) => rejectForbiddenUrdfFields(item, `${path}[${index}]`));
    return;
  }
  for (const [key,item] of Object.entries(value)) {
    if (FORBIDDEN_URDF_KEYS.test(key)) {
      fail('EMBODIEDGEN_URDF_PROPOSAL_FORBIDDEN_FIELD', `URDF proposal contains forbidden executable/transport field: ${path}.${key}`);
    }
    rejectForbiddenUrdfFields(item, `${path}.${key}`);
  }
};

const normalizeUrdfProposal = (payload) => {
  const proposal=payload?.partProposal;
  if (!proposal || proposal.version !== 1 || proposal.source !== 'urdf/yourdfpy' || proposal.frameConvention !== 'urdf-link-local' || !Array.isArray(proposal.parts)) {
    fail('EMBODIEDGEN_URDF_PROPOSAL_INVALID', 'URDF proposal requires Part Proposal v1 from urdf/yourdfpy with urdf-link-local frameConvention.');
  }
  if (proposal.parts.length > URDF_PROPOSAL_MAX_PARTS) {
    fail('EMBODIEDGEN_URDF_PROPOSAL_INVALID', `URDF proposal exceeds ${URDF_PROPOSAL_MAX_PARTS} movable parts.`);
  }
  rejectForbiddenUrdfFields(proposal);
  const seen=new Set();
  const seenNodes=new Set();
  const parts=proposal.parts.map((raw,index) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) fail('EMBODIEDGEN_URDF_PROPOSAL_INVALID', `URDF proposal part ${index} must be an object.`);
    const id=safeEvidenceText(raw.id, `parts[${index}].id`);
    if (!URDF_PART_ID.test(id) || id === '$root') fail('EMBODIEDGEN_URDF_PROPOSAL_INVALID', `URDF proposal part id is not a stable identifier: ${id}`);
    if (seen.has(id)) fail('EMBODIEDGEN_URDF_PROPOSAL_INVALID', `Duplicate URDF proposal part id: ${id}`);
    seen.add(id);
    const node=safeEvidenceText(raw.node, `parts[${index}].node`);
    if (seenNodes.has(node)) fail('EMBODIEDGEN_URDF_PROPOSAL_INVALID', `Duplicate URDF proposal child node: ${node}`);
    seenNodes.add(node);
    const parent=safeEvidenceText(raw.parent || '$root', `parts[${index}].parent`, { allowRoot:true });
    if (parent !== '$root' && !URDF_PART_ID.test(parent)) fail('EMBODIEDGEN_URDF_PROPOSAL_INVALID', `URDF proposal parent is not a stable identifier: ${parent}`);
    const joint=raw.joint;
    if (!joint || typeof joint !== 'object' || Array.isArray(joint) || !URDF_JOINT_TYPES.has(joint.type)) {
      fail('EMBODIEDGEN_URDF_PROPOSAL_INVALID', `URDF proposal part ${id} requires revolute/prismatic/continuous joint.`);
    }
    const axis=finiteVector(joint.axis,3,`parts[${index}].joint.axis`);
    if (Math.hypot(...axis) < 1e-9) fail('EMBODIEDGEN_URDF_PROPOSAL_INVALID', `URDF proposal part ${id} has zero joint axis.`);
    let limits;
    if (joint.limits != null) {
      limits=finiteVector(joint.limits,2,`parts[${index}].joint.limits`);
      if (limits[0] >= limits[1]) fail('EMBODIEDGEN_URDF_PROPOSAL_INVALID', `URDF proposal part ${id} has invalid joint limits.`);
    }
    const urdf=joint.urdf;
    if (!urdf || typeof urdf !== 'object' || Array.isArray(urdf)) fail('EMBODIEDGEN_URDF_PROPOSAL_INVALID', `URDF proposal part ${id} requires urdf metadata.`);
    const normalizedUrdf={
      name:safeEvidenceText(urdf.name, `parts[${index}].joint.urdf.name`),
      parentLink:safeEvidenceText(urdf.parentLink, `parts[${index}].joint.urdf.parentLink`),
      childLink:safeEvidenceText(urdf.childLink, `parts[${index}].joint.urdf.childLink`),
      originMatrix:finiteMatrix4(urdf.originMatrix,`parts[${index}].joint.urdf.originMatrix`),
      parentToJointMatrix:finiteMatrix4(urdf.parentToJointMatrix,`parts[${index}].joint.urdf.parentToJointMatrix`)
    };
    const confidence=Number(raw.confidence ?? proposal.confidence ?? 0);
    if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) fail('EMBODIEDGEN_URDF_PROPOSAL_INVALID', `URDF proposal part ${id} confidence must be within [0,1].`);
    return {
      id,node,parent,
      joint:{type:joint.type,axis,...(limits?{limits}:{}),urdf:normalizedUrdf},
      confidence
    };
  });
  const ids=new Set(parts.map((part)=>part.id));
  for (const part of parts) {
    if (part.parent === part.id) fail('EMBODIEDGEN_URDF_PROPOSAL_INVALID', `URDF proposal part cannot parent itself: ${part.id}`);
    if (part.parent !== '$root' && !ids.has(part.parent)) {
      fail('EMBODIEDGEN_URDF_PROPOSAL_INVALID', `URDF proposal parent does not exist: ${part.parent}`);
    }
  }
  const byId=new Map(parts.map((part)=>[part.id,part]));
  for (const part of parts) {
    const visited=new Set([part.id]);
    let parent=part.parent;
    while (parent !== '$root') {
      if (visited.has(parent)) fail('EMBODIEDGEN_URDF_PROPOSAL_INVALID', `URDF proposal hierarchy contains a cycle at ${parent}`);
      visited.add(parent);
      parent=byId.get(parent)?.parent || '$root';
    }
  }
  const confidence=Number(proposal.confidence ?? 0);
  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) fail('EMBODIEDGEN_URDF_PROPOSAL_INVALID', 'URDF proposal confidence must be within [0,1].');
  return {version:1,source:'urdf/yourdfpy',frameConvention:'urdf-link-local',confidence,parts};
};

const safeErrorCode = (error) => {
  const code=String(error?.code || error?.name || 'URDF_PROPOSAL_FAILED').trim();
  return /^[A-Za-z0-9._:-]{1,120}$/.test(code) ? code : 'URDF_PROPOSAL_FAILED';
};

const evidenceLevel = (roles, urdfStatus = 'none') => ({
  partSegmentation: roles.has('part_segmentation') ? 'provider' : 'none',
  partSemantics: roles.has('part_semantics') ? 'provider-unverified' : 'none',
  grasps: roles.has('sapien_grasps') ? 'sapien-validated-provider-only' : roles.has('raw_grasps') ? 'raw-provider-only' : 'none',
  urdf:urdfStatus
});

export class EmbodiedGenBundleAdapter {
  constructor({ compilerProvider = null } = {}) { this.compilerProvider=compilerProvider; }

  /**
   * Convert a versioned EmbodiedGen artifact bundle into existing AssetCompiler input.
   * This adapter preserves provider evidence; it never creates a runtime Manifest.
   */
  async prepare(bundle, { artifactBytes = {} } = {}) {
    if (!bundle || bundle.version !== 1 || bundle.provider !== 'embodiedgen' || !Array.isArray(bundle.artifacts)) {
      fail('EMBODIEDGEN_BUNDLE_INVALID', 'EmbodiedGen bundle requires version=1, provider="embodiedgen" and artifacts[].');
    }
    const sourceJobId = String(bundle.sourceJobId || bundle.job?.id || '').trim();
    if (sourceJobId && !JOB_ID.test(sourceJobId)) fail('EMBODIEDGEN_JOB_ID_INVALID', `Invalid EmbodiedGen source job id: ${sourceJobId}`);

    const seenIds = new Set(); const seenRoles = new Set();
    const descriptors = bundle.artifacts.map((descriptor) => assertDescriptor(descriptor, seenIds, seenRoles));
    const byRole = new Map(descriptors.map((descriptor) => [descriptor.role, descriptor]));
    const primary = byRole.get('primary_glb');
    if (!primary) fail('EMBODIEDGEN_PRIMARY_GLB_MISSING', 'EmbodiedGen bundle requires exactly one primary_glb artifact.');
    if (primary.mediaType !== 'model/gltf-binary') {
      fail('EMBODIEDGEN_PRIMARY_GLB_MEDIA_TYPE_INVALID', `primary_glb must use model/gltf-binary, got ${primary.mediaType}.`);
    }
    const primaryBytes = normalizeBytes(artifactBytesFor(artifactBytes, primary), primary.id);
    await assertHash(primary, primaryBytes);

    const verifiedRoles=new Set(['primary_glb']);
    let partSegmentation = null;
    const segmentationDescriptor = byRole.get('part_segmentation');
    if (segmentationDescriptor) {
      const segmentationBytes = normalizeBytes(artifactBytesFor(artifactBytes, segmentationDescriptor), segmentationDescriptor.id);
      await assertHash(segmentationDescriptor, segmentationBytes);
      verifiedRoles.add('part_segmentation');
      partSegmentation = parseJsonArtifact(segmentationDescriptor, segmentationBytes);
      validateSegmentation(partSegmentation, primary);
    }

    let partProposal=null;
    let urdfEvidence=null;
    let urdfStatus='none';
    const urdfDescriptor=byRole.get('source_urdf');
    if (urdfDescriptor) {
      if (!['application/xml','text/xml','application/urdf+xml'].includes(urdfDescriptor.mediaType)) {
        fail('EMBODIEDGEN_URDF_MEDIA_TYPE_INVALID', `source_urdf has unsupported media type: ${urdfDescriptor.mediaType}`);
      }
      const urdfBytes=normalizeBytes(artifactBytesFor(artifactBytes,urdfDescriptor),urdfDescriptor.id);
      if (urdfBytes.byteLength > URDF_MAX_BYTES) {
        fail('EMBODIEDGEN_URDF_TOO_LARGE', `source_urdf exceeds ${URDF_MAX_BYTES} bytes.`, { bytes:urdfBytes.byteLength, maxBytes:URDF_MAX_BYTES });
      }
      await assertHash(urdfDescriptor,urdfBytes);
      verifiedRoles.add('source_urdf');
      urdfStatus='verified-bytes-only';
      urdfEvidence={artifactId:urdfDescriptor.id,sha256:urdfDescriptor.sha256,status:urdfStatus,parser:null,partCount:null,frameConvention:null};
      const parser=this.compilerProvider;
      const canParse=typeof parser?.runUrdfProposal === 'function' && (typeof parser.isConfigured !== 'function' || parser.isConfigured());
      if (canParse) {
        try {
          partProposal=normalizeUrdfProposal(await parser.runUrdfProposal(urdfBytes));
          urdfStatus='service-parsed';
          urdfEvidence={
            artifactId:urdfDescriptor.id,sha256:urdfDescriptor.sha256,status:urdfStatus,
            parser:'asset-compiler/yourdfpy',partCount:partProposal.parts.length,frameConvention:partProposal.frameConvention
          };
        } catch (error) {
          partProposal=null;
          urdfStatus='parse-rejected';
          urdfEvidence={
            artifactId:urdfDescriptor.id,sha256:urdfDescriptor.sha256,status:urdfStatus,
            parser:'asset-compiler/yourdfpy',partCount:null,frameConvention:null,errorCode:safeErrorCode(error)
          };
        }
      }
    }

    const providerEvidence = {
      provider:'embodiedgen',
      bundleVersion:1,
      sourceJobId:sourceJobId || null,
      lineage:safeLineage(bundle.lineage),
      levels:evidenceLevel(seenRoles,urdfStatus),
      ...(urdfEvidence ? { urdf:urdfEvidence } : {}),
      artifacts:descriptors.map((descriptor) => ({ ...descriptor, verified:verifiedRoles.has(descriptor.role) }))
    };

    const asset = bundle.asset && typeof bundle.asset === 'object' ? bundle.asset : {};
    const compilerInput = {
      bytes:primaryBytes,
      sourceName:primary.fileName || primary.path?.split('/').pop() || 'embodiedgen.glb',
      assetId:asset.id || bundle.assetId || undefined,
      label:asset.label || bundle.label || undefined,
      partSegmentation,
      // Only mechanically parsed URDF evidence may become a Part Proposal candidate.
      // Semantic and grasp evidence remain non-executable provider evidence.
      partProposal,
      providerEvidence
    };
    return { compilerInput, providerEvidence };
  }
}
