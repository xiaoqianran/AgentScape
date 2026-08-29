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


const GRASP_MAX_BYTES = 2 * 1024 * 1024;
const GRASP_MAX_CANDIDATES = 256;
const GRASP_SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$/;
const FORBIDDEN_GRASP_KEYS = /(actions?|pickup|held|runtime[-_]?verified|(^|[_-])verified($|[_-])|authorization|api[-_]?key|token|secret|credential|signed[-_]?url|(^|[_-])url($|[_-])|(^|[_-])path($|[_-])|prompt|image[-_]?bytes|base64)/i;

const safeGraspText=(value,label,max=160)=>{
  const text=String(value ?? '').trim();
  if (!text || text.length>max || /[\u0000-\u001f\u007f]/.test(text) || /https?:\/\/|Bearer\s+/i.test(text)) {
    fail('EMBODIEDGEN_GRASP_INVALID',`${label} must be bounded safe text.`);
  }
  return text;
};

const rejectForbiddenGraspFields=(value,path='graspEvidence')=>{
  if (!value || typeof value!=='object') return;
  if (Array.isArray(value)) {
    value.forEach((item,index)=>rejectForbiddenGraspFields(item,`${path}[${index}]`));
    return;
  }
  for (const [key,item] of Object.entries(value)) {
    if (FORBIDDEN_GRASP_KEYS.test(key)) {
      fail('EMBODIEDGEN_GRASP_FORBIDDEN_FIELD',`Grasp evidence contains forbidden execution/transport field: ${path}.${key}`);
    }
    rejectForbiddenGraspFields(item,`${path}.${key}`);
  }
};

const determinant3=(m)=>
  m[0][0]*(m[1][1]*m[2][2]-m[1][2]*m[2][1])-
  m[0][1]*(m[1][0]*m[2][2]-m[1][2]*m[2][0])+
  m[0][2]*(m[1][0]*m[2][1]-m[1][1]*m[2][0]);
const dot3=(a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
const rigidGraspPose=(value,label)=>{
  if (!Array.isArray(value) || value.length!==4 || value.some((row)=>!Array.isArray(row)||row.length!==4||!row.every(Number.isFinite))) {
    fail('EMBODIEDGEN_GRASP_INVALID',`${label} requires finite 4x4 pose.`);
  }
  const pose=value.map((row)=>row.map(Number));
  const tail=pose[3];
  if (Math.abs(tail[0])>1e-6 || Math.abs(tail[1])>1e-6 || Math.abs(tail[2])>1e-6 || Math.abs(tail[3]-1)>1e-6) {
    fail('EMBODIEDGEN_GRASP_INVALID',`${label} must be affine with [0,0,0,1] final row.`);
  }
  const r=pose.slice(0,3).map((row)=>row.slice(0,3));
  for (let i=0;i<3;i++) {
    if (Math.abs(dot3(r[i],r[i])-1)>1e-3) fail('EMBODIEDGEN_GRASP_INVALID',`${label} rotation rows must be unit length.`);
    for (let j=i+1;j<3;j++) if (Math.abs(dot3(r[i],r[j]))>1e-3) fail('EMBODIEDGEN_GRASP_INVALID',`${label} rotation rows must be orthogonal.`);
  }
  if (Math.abs(determinant3(r)-1)>1e-3) fail('EMBODIEDGEN_GRASP_INVALID',`${label} rotation must be right-handed.`);
  for (let i=0;i<3;i++) if (Math.abs(pose[i][3])>1e6) fail('EMBODIEDGEN_GRASP_INVALID',`${label} translation exceeds bounded evidence range.`);
  return pose;
};

const normalizeGraspEvidence=(payload,{role,descriptor,bundleSourceJobId=null})=>{
  if (!payload || typeof payload!=='object' || Array.isArray(payload) || payload.version!==1 || !Array.isArray(payload.grasps)) {
    fail('EMBODIEDGEN_GRASP_INVALID',`${role} must be Grasp Evidence v1 with grasps[].`);
  }
  rejectForbiddenGraspFields(payload);
  if (payload.grasps.length>GRASP_MAX_CANDIDATES) fail('EMBODIEDGEN_GRASP_INVALID',`${role} exceeds ${GRASP_MAX_CANDIDATES} grasp candidates.`);
  const expectedLevel=role==='sapien_grasps'?'simulator-validated':'raw';
  if (String(payload.evidence_level||'')!==expectedLevel) {
    fail('EMBODIEDGEN_GRASP_INVALID',`${role} requires evidence_level=${expectedLevel}.`);
  }
  const sourceJobId=payload.source_job_id==null?null:String(payload.source_job_id).trim();
  const outputJobId=payload.output_job_id==null?null:String(payload.output_job_id).trim();
  if (sourceJobId && !JOB_ID.test(sourceJobId)) fail('EMBODIEDGEN_GRASP_INVALID',`${role} source_job_id is invalid.`);
  if (outputJobId && !JOB_ID.test(outputJobId)) fail('EMBODIEDGEN_GRASP_INVALID',`${role} output_job_id is invalid.`);
  if (bundleSourceJobId && sourceJobId && sourceJobId!==bundleSourceJobId) {
    fail('EMBODIEDGEN_GRASP_SOURCE_MISMATCH',`${role} source_job_id does not match bundle sourceJobId.`,{bundleSourceJobId,graspSourceJobId:sourceJobId});
  }
  const gripper=safeGraspText(payload.gripper,`${role}.gripper`,120);
  if (!GRASP_SAFE_ID.test(gripper)) fail('EMBODIEDGEN_GRASP_INVALID',`${role}.gripper must be a stable identifier.`);
  const sourceFrame=safeGraspText(payload.source_frame,`${role}.source_frame`,160);
  const backend=safeGraspText(payload.backend,`${role}.backend`,120);
  const seenRanks=new Set();
  let topScore=null;
  payload.grasps.forEach((grasp,index)=>{
    if (!grasp || typeof grasp!=='object' || Array.isArray(grasp)) fail('EMBODIEDGEN_GRASP_INVALID',`${role}.grasps[${index}] must be an object.`);
    const rank=Number(grasp.rank);
    const score=Number(grasp.score);
    if (!Number.isSafeInteger(rank)||rank<0||seenRanks.has(rank)) fail('EMBODIEDGEN_GRASP_INVALID',`${role}.grasps[${index}].rank must be unique non-negative integer.`);
    seenRanks.add(rank);
    if (!Number.isFinite(score)||score<0||score>1) fail('EMBODIEDGEN_GRASP_INVALID',`${role}.grasps[${index}].score must be within [0,1].`);
    rigidGraspPose(grasp.pose,`${role}.grasps[${index}].pose`);
    topScore=topScore==null?score:Math.max(topScore,score);
  });
  if (payload.seed!=null && !Number.isSafeInteger(Number(payload.seed))) fail('EMBODIEDGEN_GRASP_INVALID',`${role}.seed must be a safe integer.`);
  return {
    artifactId:descriptor.id,
    sha256:descriptor.sha256,
    status:'verified',
    evidenceLevel:expectedLevel,
    count:payload.grasps.length,
    topScore,
    gripper,
    sourceFrame,
    backend,
    sourceJobId,
    outputJobId,
    ...(payload.seed==null?{}:{seed:Number(payload.seed)})
  };
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

const SEMANTIC_MAX_BYTES = 1024 * 1024;
const SEMANTIC_SAFE_TEXT = /^[^\u0000-\u001f\u007f]{1,800}$/;
const SEMANTIC_FORBIDDEN_KEYS = /(joint|axis|anchors?|limits?|motor|actions?|targets?|pickup|runtime[-_]?verified|(^|[_-])verified($|[_-])|authorization|api[-_]?key|token|secret|credential|signed[-_]?url|(^|[_-])url($|[_-])|(^|[_-])path($|[_-])|image[-_]?bytes|base64)/i;

const safeSemanticText=(value,label,max=800)=>{
  const text=String(value ?? '').trim();
  if (!text || text.length>max || !SEMANTIC_SAFE_TEXT.test(text) || /https?:\/\/|Bearer\s+/i.test(text)) {
    fail('EMBODIEDGEN_SEMANTICS_INVALID',`${label} must be bounded safe text.`);
  }
  return text;
};

const rejectForbiddenSemanticFields=(value,path='partSemantics')=>{
  if (!value || typeof value!=='object') return;
  if (Array.isArray(value)) {
    value.forEach((item,index)=>rejectForbiddenSemanticFields(item,`${path}[${index}]`));
    return;
  }
  for (const [key,item] of Object.entries(value)) {
    if (SEMANTIC_FORBIDDEN_KEYS.test(key)) {
      fail('EMBODIEDGEN_SEMANTICS_FORBIDDEN_FIELD',`Part semantics contains forbidden executable/secret field: ${path}.${key}`);
    }
    rejectForbiddenSemanticFields(item,`${path}.${key}`);
  }
};

const normalizeSemanticEvidence=(payload,{descriptor,bundleSourceJobId,segmentation,segmentationDescriptor})=>{
  if (!payload || typeof payload!=='object' || Array.isArray(payload) || payload.version!==1 || payload.source!=='embodiedgen/gpt-part-semantics' || payload.profile!=='part-semantics-v1' || !Array.isArray(payload.parts)) {
    fail('EMBODIEDGEN_SEMANTICS_INVALID','part_semantics must be EmbodiedGen Part Semantics v1.');
  }
  rejectForbiddenSemanticFields(payload);
  const sourceJobId=String(payload.sourceJobId || '').trim();
  const outputJobId=String(payload.outputJobId || '').trim();
  if (!JOB_ID.test(sourceJobId) || !JOB_ID.test(outputJobId)) fail('EMBODIEDGEN_SEMANTICS_INVALID','part_semantics requires valid sourceJobId/outputJobId.');
  if (bundleSourceJobId && sourceJobId!==bundleSourceJobId) {
    fail('EMBODIEDGEN_SEMANTICS_SOURCE_MISMATCH','part_semantics sourceJobId does not match bundle sourceJobId.',{bundleSourceJobId,semanticSourceJobId:sourceJobId});
  }
  const boundSegmentationSha=String(payload.input?.segmentationSha256 || '').toLowerCase();
  if (!HEX_SHA256.test(boundSegmentationSha) || boundSegmentationSha!==segmentationDescriptor.sha256) {
    fail('EMBODIEDGEN_SEMANTICS_SEGMENTATION_MISMATCH','part_semantics is not bound to the bundle part_segmentation SHA-256.',{expected:segmentationDescriptor.sha256,actual:boundSegmentationSha||null});
  }
  const expectedIds=new Set((segmentation?.segments || []).map((item)=>String(item?.id ?? '')).filter(Boolean));
  if (!expectedIds.size) fail('EMBODIEDGEN_SEMANTICS_INVALID','part_semantics requires non-empty segmentation IDs.');
  const seen=new Set();
  const parts=[];
  for (let index=0;index<payload.parts.length;index++) {
    const raw=payload.parts[index];
    if (!raw || typeof raw!=='object' || Array.isArray(raw)) fail('EMBODIEDGEN_SEMANTICS_INVALID',`part_semantics.parts[${index}] must be an object.`);
    const rawId=raw.id;
    const id=typeof rawId==='number' && Number.isSafeInteger(rawId) ? String(rawId) : String(rawId ?? '').trim();
    if (!id || !expectedIds.has(id) || seen.has(id)) fail('EMBODIEDGEN_SEMANTICS_INVALID',`Invalid or duplicate semantic part id: ${id||'<missing>'}.`);
    seen.add(id);
    const maskColor=safeSemanticText(raw.mask_color,`parts[${index}].mask_color`,80);
    const partName=safeSemanticText(raw.part_name,`parts[${index}].part_name`,160);
    if (typeof raw.graspable!=='boolean') fail('EMBODIEDGEN_SEMANTICS_INVALID',`parts[${index}].graspable must be boolean.`);
    const scenarios=raw.grasp_scenarios;
    if (!Array.isArray(scenarios) || scenarios.length>8) fail('EMBODIEDGEN_SEMANTICS_INVALID',`parts[${index}].grasp_scenarios must be a bounded list.`);
    if (raw.graspable && !scenarios.length) fail('EMBODIEDGEN_SEMANTICS_INVALID',`Graspable semantic part ${id} requires a grasp scenario.`);
    if (!raw.graspable && scenarios.length) fail('EMBODIEDGEN_SEMANTICS_INVALID',`Non-graspable semantic part ${id} must not claim grasp scenarios.`);
    const normalizedScenarios=scenarios.map((scenario,scenarioIndex)=>{
      if (!scenario || typeof scenario!=='object' || Array.isArray(scenario) || new Set(Object.keys(scenario)).size!==2 || !Object.hasOwn(scenario,'scenario') || !Object.hasOwn(scenario,'confidence')) {
        fail('EMBODIEDGEN_SEMANTICS_INVALID',`parts[${index}].grasp_scenarios[${scenarioIndex}] has invalid schema.`);
      }
      const text=safeSemanticText(scenario.scenario,`parts[${index}].grasp_scenarios[${scenarioIndex}].scenario`,280);
      const confidence=Number(scenario.confidence);
      if (!Number.isFinite(confidence) || confidence<0 || confidence>1) fail('EMBODIEDGEN_SEMANTICS_INVALID',`parts[${index}].grasp_scenarios[${scenarioIndex}].confidence must be within [0,1].`);
      return {scenario:text,confidence};
    });
    if (!Array.isArray(raw.functional_labels) || raw.functional_labels.length<1 || raw.functional_labels.length>8) {
      fail('EMBODIEDGEN_SEMANTICS_INVALID',`parts[${index}].functional_labels must contain 1..8 labels.`);
    }
    const functionalLabels=raw.functional_labels.map((label,labelIndex)=>safeSemanticText(label,`parts[${index}].functional_labels[${labelIndex}]`,160));
    const description=safeSemanticText(raw.semantic_description,`parts[${index}].semantic_description`,800);
    parts.push({id,maskColor,partName,graspable:raw.graspable,graspScenarios:normalizedScenarios,functionalLabels,description});
  }
  if (seen.size!==expectedIds.size || [...expectedIds].some((id)=>!seen.has(id))) {
    fail('EMBODIEDGEN_SEMANTICS_ID_COVERAGE','part_semantics IDs must exactly cover segmentation IDs.',{semanticIds:[...seen].sort(),segmentationIds:[...expectedIds].sort()});
  }
  const model=safeSemanticText(payload.provenance?.model,'provenance.model',200);
  const apiStyle=safeSemanticText(payload.provenance?.apiStyle,'provenance.apiStyle',80);
  const promptRevision=String(payload.provenance?.promptRevision || '').toLowerCase();
  if (!HEX_SHA256.test(promptRevision)) fail('EMBODIEDGEN_SEMANTICS_INVALID','provenance.promptRevision must be SHA-256.');
  return {
    evidence:{
      artifactId:descriptor.id,sha256:descriptor.sha256,status:'verified',source:payload.source,profile:payload.profile,
      sourceJobId,outputJobId,partCount:parts.length,model,apiStyle,promptRevision,
      parts:parts.map(({id,partName,graspable,functionalLabels,graspScenarios})=>({id,partName,graspable,functionalLabels,graspScenarioCount:graspScenarios.length}))
    },
    proposal:{
      version:1,source:'embodiedgen/gpt-part-semantics',confidence:0,
      parts:parts.map((part)=>({id:part.id,semantic:part.partName,confidence:0}))
    }
  };
};

const safeErrorCode = (error) => {
  const code=String(error?.code || error?.name || 'URDF_PROPOSAL_FAILED').trim();
  return /^[A-Za-z0-9._:-]{1,120}$/.test(code) ? code : 'URDF_PROPOSAL_FAILED';
};

const evidenceLevel = (roles, urdfStatus = 'none', graspLevel = 'none', semanticLevel = 'none') => ({
  partSegmentation: roles.has('part_segmentation') ? 'provider' : 'none',
  partSemantics: semanticLevel === 'none' && roles.has('part_semantics') ? 'provider-unverified' : semanticLevel,
  grasps:graspLevel,
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

    let semanticProposal=null;
    let semanticEvidence=null;
    let semanticLevel='none';
    const semanticDescriptor=byRole.get('part_semantics');
    if (semanticDescriptor) {
      if (!segmentationDescriptor || !partSegmentation) {
        fail('EMBODIEDGEN_SEMANTICS_REQUIRES_SEGMENTATION','part_semantics requires verified part_segmentation in the same bundle.');
      }
      if (semanticDescriptor.mediaType!=='application/json') fail('EMBODIEDGEN_SEMANTICS_MEDIA_TYPE_INVALID','part_semantics must use application/json.');
      const rawSemanticBytes=artifactBytesFor(artifactBytes,semanticDescriptor);
      if (rawSemanticBytes == null) {
        semanticEvidence={artifactId:semanticDescriptor.id,sha256:semanticDescriptor.sha256,status:'descriptor-only'};
        semanticLevel='provider-unverified';
      } else {
        const semanticBytes=normalizeBytes(rawSemanticBytes,semanticDescriptor.id);
        if (semanticBytes.byteLength>SEMANTIC_MAX_BYTES) fail('EMBODIEDGEN_SEMANTICS_TOO_LARGE',`part_semantics exceeds ${SEMANTIC_MAX_BYTES} bytes.`,{bytes:semanticBytes.byteLength,maxBytes:SEMANTIC_MAX_BYTES});
        await assertHash(semanticDescriptor,semanticBytes);
        const semanticPayload=parseJsonArtifact(semanticDescriptor,semanticBytes);
        const normalized=normalizeSemanticEvidence(semanticPayload,{descriptor:semanticDescriptor,bundleSourceJobId:sourceJobId||null,segmentation:partSegmentation,segmentationDescriptor});
        semanticEvidence=normalized.evidence;
        semanticProposal=normalized.proposal;
        semanticLevel='provider-verified';
        verifiedRoles.add('part_semantics');
      }
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

    let semanticProposalApplied=false;
    if (semanticProposal && (!partProposal || !Array.isArray(partProposal.parts) || partProposal.parts.length===0)) {
      partProposal=semanticProposal;
      semanticProposalApplied=true;
    }

    const graspEvidence={};
    for (const role of ['raw_grasps','sapien_grasps']) {
      const descriptor=byRole.get(role);
      if (!descriptor) continue;
      if (descriptor.mediaType!=='application/json') fail('EMBODIEDGEN_GRASP_MEDIA_TYPE_INVALID',`${role} must use application/json.`);
      const rawBytes=artifactBytesFor(artifactBytes,descriptor);
      if (rawBytes == null) {
        graspEvidence[role]={artifactId:descriptor.id,sha256:descriptor.sha256,status:'descriptor-only'};
        continue;
      }
      const bytes=normalizeBytes(rawBytes,descriptor.id);
      if (bytes.byteLength>GRASP_MAX_BYTES) fail('EMBODIEDGEN_GRASP_TOO_LARGE',`${role} exceeds ${GRASP_MAX_BYTES} bytes.`,{bytes:bytes.byteLength,maxBytes:GRASP_MAX_BYTES});
      await assertHash(descriptor,bytes);
      const payload=parseJsonArtifact(descriptor,bytes);
      graspEvidence[role]=normalizeGraspEvidence(payload,{role,descriptor,bundleSourceJobId:sourceJobId||null});
      verifiedRoles.add(role);
    }
    const graspLevel = graspEvidence.sapien_grasps?.status==='verified' ? 'sapien-validated-provider-only'
      : graspEvidence.raw_grasps?.status==='verified' ? 'raw-provider-only'
      : graspEvidence.sapien_grasps ? 'sapien-provider-unverified'
      : graspEvidence.raw_grasps ? 'raw-provider-unverified'
      : 'none';

    const providerEvidence = {
      provider:'embodiedgen',
      bundleVersion:1,
      sourceJobId:sourceJobId || null,
      lineage:safeLineage(bundle.lineage),
      levels:evidenceLevel(seenRoles,urdfStatus,graspLevel,semanticLevel),
      ...(Object.keys(graspEvidence).length ? { grasps:graspEvidence } : {}),
      ...(semanticEvidence ? { semantics:{...semanticEvidence,mappedToPartProposal:semanticProposalApplied} } : {}),
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
      // Verified semantic evidence may become an unpromoted semantic-only Part Proposal.
      // Verified URDF proposal wins when it has explicit movable parts; grasp evidence remains non-executable.
      partProposal,
      providerEvidence
    };
    return { compilerInput, providerEvidence };
  }
}
