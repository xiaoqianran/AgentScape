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

const evidenceLevel = (roles) => ({
  partSegmentation: roles.has('part_segmentation') ? 'provider' : 'none',
  partSemantics: roles.has('part_semantics') ? 'provider-unverified' : 'none',
  grasps: roles.has('sapien_grasps') ? 'sapien-validated-provider-only' : roles.has('raw_grasps') ? 'raw-provider-only' : 'none'
});

export class EmbodiedGenBundleAdapter {
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

    let partSegmentation = null;
    const segmentationDescriptor = byRole.get('part_segmentation');
    if (segmentationDescriptor) {
      const segmentationBytes = normalizeBytes(artifactBytesFor(artifactBytes, segmentationDescriptor), segmentationDescriptor.id);
      await assertHash(segmentationDescriptor, segmentationBytes);
      partSegmentation = parseJsonArtifact(segmentationDescriptor, segmentationBytes);
      validateSegmentation(partSegmentation, primary);
    }

    const providerEvidence = {
      provider:'embodiedgen',
      bundleVersion:1,
      sourceJobId:sourceJobId || null,
      lineage:safeLineage(bundle.lineage),
      levels:evidenceLevel(seenRoles),
      artifacts:descriptors.map((descriptor) => ({ ...descriptor, verified:descriptor.role === 'primary_glb' || descriptor.role === 'part_segmentation' }))
    };

    const asset = bundle.asset && typeof bundle.asset === 'object' ? bundle.asset : {};
    const compilerInput = {
      bytes:primaryBytes,
      sourceName:primary.fileName || primary.path?.split('/').pop() || 'embodiedgen.glb',
      assetId:asset.id || bundle.assetId || undefined,
      label:asset.label || bundle.label || undefined,
      partSegmentation,
      // Semantic and grasp evidence are deliberately not promoted into executable Part Proposal v1.
      partProposal:null,
      providerEvidence
    };
    return { compilerInput, providerEvidence };
  }
}
