import * as THREE from 'three';
import { captureAuthoringState, exportAuthoringDocument, hydrateAuthoringState, parseAuthoringDocument } from '../../application/world-authoring/AuthoringDocument.js';
import { validateRemoteAuthoringDocument } from './RemoteAuthoringDocument.js';

export function execute(code, document) {
 const scene=hydrateAuthoringState(parseAuthoringDocument(validateRemoteAuthoringDocument(document)));
 const clear=()=>{ for(const child of [...scene.children]) scene.remove(child); };
 const unsupported=()=>{ throw new Error('AUTHORING_RUNTIME_CALLBACK_UNSUPPORTED'); };
 const defaultBeforeRender=THREE.Object3D.prototype.onBeforeRender;
 const defaultAfterRender=THREE.Object3D.prototype.onAfterRender;
 const defaultCompile=THREE.Material.prototype.onBeforeCompile;
 // This Function belongs to the WASM QuickJS VM, never to the Node host.
 const result=new Function('THREE','scene','clear','onFrame','modelRef',`"use strict";\n${code}`)(THREE,scene,clear,unsupported,unsupported);
 if (result && typeof result.then==='function') throw new Error('AUTHORING_ASYNC_UNSUPPORTED');
 scene.traverse(node=>{
  if (node!==scene && !['Mesh','Group','Object3D'].includes(node.type)) throw new Error('AUTHORING_NODE_UNSUPPORTED');
  if (node.animations?.length || node.onBeforeRender!==defaultBeforeRender || node.onAfterRender!==defaultAfterRender) throw new Error('AUTHORING_RUNTIME_CALLBACK_UNSUPPORTED');
  if (node.isMesh) {
   if (Array.isArray(node.material) || node.material.onBeforeCompile!==defaultCompile) throw new Error('AUTHORING_MATERIAL_UNSUPPORTED');
   // Materialize real buffers before crossing the boundary; never trust allocation parameters.
   delete node.geometry.parameters;
   node.geometry.type='BufferGeometry';
  }
 });
 const output=exportAuthoringDocument(captureAuthoringState(scene));
 validateRemoteAuthoringDocument(output);
 return output;
}
