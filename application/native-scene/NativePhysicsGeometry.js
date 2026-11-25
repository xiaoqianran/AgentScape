import * as THREE from 'three';

const fail=code=>Object.assign(new Error(code),{code});
const MAX_NODES=1024,MAX_VERTICES=200000,MAX_COLLIDERS=64;
const close=(a,b)=>a.elements.every((value,index)=>Math.abs(value-b.elements[index])<1e-6);
const identityScale=new THREE.Vector3(1,1,1);
const internal=object=>object.userData?.agentscapeInternal===true||object.userData?.editorOverlay===true||
  ['AgentScapeCodeWorldGizmo','AgentScapeCodeWorldEditOutline'].includes(object.name);

export function containsNativeObject(root,object){
  for(let current=object;current;current=current.parent)if(current===root)return true;
  return false;
}
export function overlapsNativeObject(a,b){return containsNativeObject(a,b)||containsNativeObject(b,a);}

/** Compile bounded, object-local oriented boxes. No body type, mass or action is inferred. */
export function analyzeNativePhysicsGeometry(root){
  if(!root?.isObject3D||root.isScene||!root.matrixAutoUpdate)throw fail('NATIVE_PHYSICS_CANDIDATE_INVALID');
  root.updateWorldMatrix(true,false);
  const rootPosition=new THREE.Vector3(),rootRotation=new THREE.Quaternion(),rootScale=new THREE.Vector3();
  root.matrixWorld.decompose(rootPosition,rootRotation,rootScale);
  if(!close(root.matrixWorld,new THREE.Matrix4().compose(rootPosition,rootRotation,identityScale)))
    throw fail('NATIVE_PHYSICS_SCALE_UNSUPPORTED');
  const inverse=root.matrixWorld.clone().invert(),colliders=[];
  const stack=[{object:root,depth:0}];let nodes=0,vertices=0;
  while(stack.length){
    const {object,depth}=stack.pop();
    if(++nodes>MAX_NODES||depth>128)throw fail('NATIVE_PHYSICS_CANDIDATE_LIMIT');
    if(internal(object))throw fail('NATIVE_PHYSICS_INTERNAL_OBJECT');
    if(object.visible===false)continue;
    object.updateWorldMatrix(false,false);
    if(object.isMesh){
      if(object.isSkinnedMesh||object.isInstancedMesh||object.isBatchedMesh||object.morphTargetInfluences?.length||
        (Array.isArray(object.material)?object.material:[object.material]).some(m=>m?.isShaderMaterial||m?.displacementMap))
        throw fail('NATIVE_PHYSICS_DEFORMED_GEOMETRY');
      const attribute=object.geometry?.getAttribute('position');
      if(!attribute||attribute.itemSize!==3||!Number.isSafeInteger(attribute.count)||attribute.count<3)
        throw fail('NATIVE_PHYSICS_GEOMETRY_INVALID');
      vertices+=attribute.count;
      if(vertices>MAX_VERTICES||colliders.length>=MAX_COLLIDERS)throw fail('NATIVE_PHYSICS_CANDIDATE_LIMIT');
      const bounds=new THREE.Box3().setFromBufferAttribute(attribute);
      const local=new THREE.Matrix4().multiplyMatrices(inverse,object.matrixWorld);
      const position=new THREE.Vector3(),rotation=new THREE.Quaternion(),scale=new THREE.Vector3();
      local.decompose(position,rotation,scale);
      if(scale.toArray().some(n=>!Number.isFinite(n)||n<=0)||
        !close(local,new THREE.Matrix4().compose(position,rotation,scale)))throw fail('NATIVE_PHYSICS_SHEAR_UNSUPPORTED');
      const center=bounds.getCenter(new THREE.Vector3()).applyMatrix4(local);
      const half=bounds.getSize(new THREE.Vector3()).multiply(scale).multiplyScalar(.5);
      if(half.toArray().some(n=>!Number.isFinite(n)||n<1e-4||n>100)||
        center.toArray().some(n=>!Number.isFinite(n)||Math.abs(n)>100))
        throw fail('NATIVE_PHYSICS_GEOMETRY_INVALID');
      colliders.push({shape:'box',halfExtents:half.toArray(),translation:center.toArray(),rotation:rotation.normalize().toArray()});
    }
    // Bound queue growth as well as visited nodes.
    if(stack.length+object.children.length+nodes>MAX_NODES)throw fail('NATIVE_PHYSICS_CANDIDATE_LIMIT');
    for(let i=object.children.length-1;i>=0;i--)stack.push({object:object.children[i],depth:depth+1});
  }
  if(!colliders.length)throw fail('NATIVE_PHYSICS_GEOMETRY_EMPTY');
  return {status:'physics-candidate',objectUuid:root.uuid,colliderSource:'mesh-bounds',colliders,
    meshCount:colliders.length,vertexCount:vertices,physicsVerified:false,
    limitations:['Conservative per-mesh oriented boxes, not exact geometry or grasp proof.',
      'Hidden meshes excluded; body type, mass, support surfaces and joints require explicit authoring.',
      'Geometry and relative transforms must stay rigid after binding.']};
}
