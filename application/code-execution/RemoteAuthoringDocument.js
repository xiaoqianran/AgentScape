// Validate all data crossing the code-runtime boundary before Three.js allocates it.
export const remoteAuthoringLimits = Object.freeze({ maxBytes:2097152, maxNodes:128, maxDepth:16, maxVertices:20000, maxIndices:120000 });
const fail = () => { throw new Error('AUTHORING_DOCUMENT_UNSUPPORTED'); };
const safeId = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(value) && !['__proto__','constructor','prototype'].includes(value);
const types = new Set(['Float32Array','Uint32Array','Uint16Array','Uint8Array','Int32Array','Int16Array','Int8Array']);
const materials = new Set(['MeshBasicMaterial','MeshStandardMaterial','MeshPhysicalMaterial']);
export function validateRemoteAuthoringDocument(document) {
 if (JSON.stringify(document).length > remoteAuthoringLimits.maxBytes) fail();
 const scan = (value, depth=0) => {
  if (depth > 40) fail();
  if (typeof value === 'number' && !Number.isFinite(value)) fail();
  if (!value || typeof value !== 'object') return;
  for (const [key,item] of Object.entries(value)) {
   if (['__proto__','constructor','prototype'].includes(key)) fail();
   scan(item,depth+1);
  }
 };
 scan(document);
 if (document?.format !== 'agentscape-world-authoring' || document.version !== 1 || document.root?.id !== 'root') fail();
 for (const key of ['geometries','materials','textures']) {
  const entries=Object.entries(document[key] || {});
  if (entries.length > 128 || entries.some(([id])=>!safeId(id))) fail();
 }
 let vertices=0,indices=0;
 for (const definition of Object.values(document.geometries || {})) {
  // Primitive parameters can request enormous allocations despite a tiny JSON payload.
  if (definition.type !== 'BufferGeometry' || !definition.json?.data?.attributes?.position) fail();
  const data=definition.json.data;
  if (data.morphAttributes && Object.keys(data.morphAttributes).length) fail();
  for (const attribute of Object.values(data.attributes)) {
   if (!types.has(attribute.type) || !Number.isInteger(attribute.itemSize) || attribute.itemSize<1 || attribute.itemSize>4 || !Array.isArray(attribute.array) || attribute.array.length>remoteAuthoringLimits.maxVertices*4 || attribute.array.some(v=>typeof v!=='number'||!Number.isFinite(v)) || attribute.isInterleavedBufferAttribute) fail();
  }
  const count=data.attributes.position.array.length/3;
  if (data.attributes.position.itemSize !== 3 || !Number.isInteger(count)) fail();
  if (data.attributes.position.array.some(v=>Math.abs(v)>100)) fail();
  vertices+=count;
  if (data.index) {
   if (!['Uint16Array','Uint32Array'].includes(data.index.type) || !Array.isArray(data.index.array) || data.index.array.some(i=>!Number.isInteger(i)||i<0||i>=count)) fail();
   indices+=data.index.array.length;
  }
  if (data.groups) {
   if (!Array.isArray(data.groups) || data.groups.length>128) fail();
   const available=data.index?.array.length ?? count;
   for (const group of data.groups) if (!Number.isInteger(group.start) || !Number.isInteger(group.count) || group.start<0 || group.count<0 || group.start+group.count>available) fail();
  }
 }
 if (vertices>remoteAuthoringLimits.maxVertices || indices>remoteAuthoringLimits.maxIndices) fail();
 const textureSlots=new Set(['map','normalMap','roughnessMap','metalnessMap','emissiveMap','alphaMap','aoMap']);
 for (const material of Object.values(document.materials || {})) {
  if (!materials.has(material.type)) fail();
  for (const [key,value] of Object.entries(material)) if ((key==='map'||key.endsWith('Map')) && value!=null && (!textureSlots.has(key) || !Object.hasOwn(document.textures||{},value))) fail();
 }
 for (const texture of Object.values(document.textures || {})) {
  const s=texture.source;
  if (s?.type!=='data' || s.dataType!=='Uint8Array' || !Number.isInteger(s.width) || !Number.isInteger(s.height) || s.width<1 || s.height<1 || s.width>256 || s.height>256 || !Array.isArray(s.data) || s.data.length!==s.width*s.height*4 || s.data.some(n=>!Number.isInteger(n)||n<0||n>255)) fail();
 }
 const ids=new Set();
 const visit=(node,depth=0)=>{
  if (depth>remoteAuthoringLimits.maxDepth || !safeId(node.id) || ids.has(node.id) || ids.size>=remoteAuthoringLimits.maxNodes) fail();
  ids.add(node.id);
  const c=node.components;
  if (!c || Object.keys(c).some(k=>!['transform','mesh','geometry','material','scene'].includes(k)) || (depth && c.scene)) fail();
  const t=c.transform?.properties;
  for (const [key,length] of [['position',3],['quaternion',4],['scale',3]]) if (!Array.isArray(t?.[key]) || t[key].length!==length || t[key].some(v=>typeof v!=='number'||!Number.isFinite(v)||Math.abs(v)>100)) fail();
  if (t.scale.some(v=>v<=0) || Math.hypot(...t.quaternion)<1e-6) fail();
  if (c.mesh && (!Object.hasOwn(document.geometries||{},c.geometry?.properties?.geometryId) || !Object.hasOwn(document.materials||{},c.material?.properties?.materialId))) fail();
  if (node.children && !Array.isArray(node.children)) fail();
  for (const child of node.children || []) visit(child,depth+1);
 };
 visit(document.root);
 return document;
}
