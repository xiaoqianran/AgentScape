import * as THREE from 'three';
import { ConvexGeometry } from 'three/addons/geometries/ConvexGeometry.js';

const fail=code=>Object.assign(new Error(code),{code});
const unit=[0,0,0,1],origin=[0,0,0];

function colliderMesh(spec){
  if(spec.shape==='box')return new THREE.BoxGeometry(...spec.halfExtents.map(n=>2*n));
  if(spec.shape==='cylinder')return new THREE.CylinderGeometry(spec.radius,spec.radius,2*spec.halfHeight,24);
  if(spec.shape==='capsule')return new THREE.CapsuleGeometry(spec.radius,2*spec.halfHeight,8,16);
  if(spec.shape==='convexHull'){
    if(!Array.isArray(spec.vertices)||spec.vertices.length%3||spec.vertices.length<12||spec.vertices.length>60000)
      throw fail('NATIVE_NAVIGATION_GEOMETRY_INVALID');
    const points=[];
    for(let i=0;i<spec.vertices.length;i+=3)points.push(new THREE.Vector3(...spec.vertices.slice(i,i+3)));
    return new ConvexGeometry(points);
  }
  throw fail('NATIVE_NAVIGATION_COLLIDER_UNSUPPORTED');
}

/** Exact registered box/trimesh inputs; curved primitives are tessellated.
 * No host-render geometry or ObjectStore identity is created or changed.
 */
export function nativeColliderNavigationInputs(colliders,bodyPose={position:origin,rotation:unit},budget={triangles:0,vertices:0,colliders:0}){
  if(!Array.isArray(colliders))throw fail('NATIVE_NAVIGATION_GEOMETRY_INVALID');
  const body=new THREE.Matrix4().compose(new THREE.Vector3(...bodyPose.position),new THREE.Quaternion(...bodyPose.rotation),new THREE.Vector3(1,1,1));
  const result=[];
  for(const spec of colliders){
    if(++budget.colliders>2048)throw fail('NATIVE_NAVIGATION_BUILD_LIMIT');
    if(!spec||typeof spec!=='object')throw fail('NATIVE_NAVIGATION_GEOMETRY_INVALID');
    const matrix=body.clone().multiply(new THREE.Matrix4().compose(new THREE.Vector3(...(spec.translation||origin)),new THREE.Quaternion(...(spec.rotation||unit)),new THREE.Vector3(1,1,1)));
    let geometry=null;
    try{
      if(spec.shape!=='trimesh')geometry=colliderMesh(spec);
      const attribute=geometry?.getAttribute('position'),source=attribute?.array||spec.vertices;
      const sourceIndices=geometry?(geometry.getIndex()?.array||Uint32Array.from({length:attribute.count},(_,i)=>i)):spec.indices;
      if(!source||!sourceIndices||source.length%3||sourceIndices.length%3||source.length<9||
         source.length>600000||sourceIndices.length>300000)throw fail('NATIVE_NAVIGATION_GEOMETRY_INVALID');
      budget.triangles+=sourceIndices.length/3;budget.vertices+=source.length/3;
      if(budget.triangles>200000||budget.vertices>400000)throw fail('NATIVE_NAVIGATION_BUILD_LIMIT');
      const positions=new Float32Array(source.length),indices=new Uint32Array(sourceIndices.length);
      const vertex=new THREE.Vector3();
      for(let i=0;i<source.length;i+=3){
        vertex.fromArray(source,i).applyMatrix4(matrix);
        if(![vertex.x,vertex.y,vertex.z].every(Number.isFinite))throw fail('NATIVE_NAVIGATION_GEOMETRY_INVALID');
        vertex.toArray(positions,i);
      }
      for(let i=0;i<sourceIndices.length;i++){
        const index=sourceIndices[i];
        if(!Number.isSafeInteger(index)||index<0||index>=source.length/3)throw fail('NATIVE_NAVIGATION_GEOMETRY_INVALID');
        indices[i]=index;
      }
      result.push({positions,indices});
    }finally{geometry?.dispose();}
  }
  return result;
}

export function nativeFixedNavigationInputs(physics,budget={triangles:0,vertices:0,colliders:0}){
  const inputs=[];
  for(const entry of physics?.entries?.values?.()||[]){
    if(!entry.nativeNavigation||entry.rootSpec?.body!=='fixed')continue;
    const pose=physics.backend.bodyPose(entry.body);
    if(!pose)throw fail('NATIVE_NAVIGATION_BODY_UNAVAILABLE');
    inputs.push(...nativeColliderNavigationInputs(entry.rootSpec.colliders,pose,budget));
  }
  return inputs;
}

/** Bound native build inputs before the WASM tile generator allocates a grid. */
export function validateNativeNavigationInputs(inputs){
  let triangles=0,vertices=0,minX=Infinity,maxX=-Infinity,minZ=Infinity,maxZ=-Infinity;
  for(const {positions,indices} of inputs){
    triangles+=indices.length/3;vertices+=positions.length/3;
    if(triangles>200000||vertices>400000)throw fail('NATIVE_NAVIGATION_BUILD_LIMIT');
    for(let i=0;i<positions.length;i+=3){
      const x=positions[i],y=positions[i+1],z=positions[i+2];
      if(![x,y,z].every(Number.isFinite)||Math.max(Math.abs(x),Math.abs(y),Math.abs(z))>10000)
        throw fail('NATIVE_NAVIGATION_GEOMETRY_INVALID');
      minX=Math.min(minX,x);maxX=Math.max(maxX,x);minZ=Math.min(minZ,z);maxZ=Math.max(maxZ,z);
    }
  }
  if(maxX-minX>256||maxZ-minZ>256)throw fail('NATIVE_NAVIGATION_EXTENT_LIMIT');
}
