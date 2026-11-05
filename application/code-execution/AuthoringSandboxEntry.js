import * as THREE from 'three';
import { captureAuthoringState, exportAuthoringDocument, hydrateAuthoringState, parseAuthoringDocument } from '../world-authoring/AuthoringDocument.js';
import { validateRemoteAuthoringDocument } from './RemoteAuthoringDocument.js';
const defaultBeforeRender=THREE.Object3D.prototype.onBeforeRender;
const defaultAfterRender=THREE.Object3D.prototype.onAfterRender;
const defaultCompile=THREE.Material.prototype.onBeforeCompile;

export function execute(code, document) {
 const scene=hydrateAuthoringState(parseAuthoringDocument(validateRemoteAuthoringDocument(document)));
 const clear=()=>{ for(const child of [...scene.children]) scene.remove(child); };
 const unsupported=()=>{ throw new Error('AUTHORING_RUNTIME_CALLBACK_UNSUPPORTED'); };
 // This Function belongs to the WASM QuickJS VM, never to the Node host.
 const result=new Function('THREE','scene','clear','onFrame','modelRef',`"use strict";\n${code}`)(THREE,scene,clear,unsupported,unsupported);
 if (result && typeof result.then==='function') throw new Error('AUTHORING_ASYNC_UNSUPPORTED');
 return serialize(scene);
}
function serialize(scene) {
 scene.traverse(node=>{
  if (node!==scene && !['Mesh','Group','Object3D'].includes(node.type)) throw new Error('AUTHORING_NODE_UNSUPPORTED');
  if (node.animations?.length || node.onBeforeRender!==defaultBeforeRender || node.onAfterRender!==defaultAfterRender) throw new Error('AUTHORING_RUNTIME_CALLBACK_UNSUPPORTED');
  if (node.isMesh) {
   if (Array.isArray(node.material) || !['MeshBasicMaterial','MeshStandardMaterial','MeshPhysicalMaterial'].includes(node.material.type) || node.material.onBeforeCompile!==defaultCompile) throw new Error('AUTHORING_MATERIAL_UNSUPPORTED');
   // Materialize real buffers before crossing the boundary; never trust allocation parameters.
   delete node.geometry.parameters;
   node.geometry.type='BufferGeometry';
  }
 });
 const output=exportAuthoringDocument(captureAuthoringState(scene));
 validateRemoteAuthoringDocument(output);
 return output;
}

export function build(source) {
 if (!/^\s*export\s+function\s+createAsset\s*\(/m.test(source)) throw new Error('PROCEDURAL_ENTRY_REQUIRED');
 const code=source.replace(/\bexport\s+function\s+createAsset\s*\(/,'function createAsset(');
 const root=new Function('THREE',`"use strict";\n${code}\nreturn createAsset(THREE);`)(THREE);
 return serializeAsset(root);
}

export function serializeAsset(root) {
 if (!root?.isObject3D || root.isScene) throw new Error('PROCEDURAL_ROOT_INVALID');
 if (root.position.length()>1e-8 || root.scale.distanceTo(new THREE.Vector3(1,1,1))>1e-8 || Math.abs(root.quaternion.w)<1-1e-8) throw new Error('PROCEDURAL_ROOT_TRANSFORM_UNSUPPORTED');
 const scene=new THREE.Scene();root.userData.authoringId='asset-root';scene.add(root);
 return serialize(scene);
}

