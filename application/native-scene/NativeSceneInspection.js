import { Box3, Frustum, Matrix4, PerspectiveCamera, Vector3 } from 'three';
import { createMaterialInventory } from './NativeMaterialInspection.js';
import { createLightingInventory } from './NativeLightingInspection.js';

// Bound CPU work as well as the response. Inspect the relevant child path for
// large scenes rather than returning every object or allocating geometry copies.
const MAX_NODES=4096, MAX_VERTICES=2_000_000, MAX_INSTANCES=50_000, MAX_TRIANGLES=100_000_000, MAX_DEPTH=128;
const fail=code=>Object.assign(new Error(code),{code});
const finiteBox=box=>!box.isEmpty()&&[...box.min.toArray(),...box.max.toArray()].every(Number.isFinite);
const vector=v=>v.toArray().map(n=>Number.isFinite(n)?Number(n.toPrecision(10)):null);
const nameOf=o=>String(o.name||'').slice(0,120);
const childPath=(path,index)=>path?path+'/'+index:String(index);

export function resolveNode(scene,path){
  if(typeof path!=='string'||path.length>256||! /^(?:(?:0|[1-9]\d*)(?:\/(?:0|[1-9]\d*))*)?$/.test(path))
    throw fail('NATIVE_INSPECT_PATH_INVALID');
  let node=scene, visible=scene.visible!==false;
  for(const segment of path?path.split('/'):[]){
    const i=Number(segment);
    if(!Number.isSafeInteger(i)||!node.children[i])throw fail('NATIVE_INSPECT_NODE_NOT_FOUND');
    node=node.children[i];visible=visible&&node.visible!==false;
  }
  return {node,visible};
}

function cameraCoverage(camera,bounds,complete){
  if(!complete||!camera?.isCamera)return 'unknown';
  if(bounds.isEmpty())return 'empty';
  camera.updateWorldMatrix(true,false);
  const projection=new Matrix4().multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse);
  if(!projection.elements.every(Number.isFinite))return 'unknown';
  const frustum=new Frustum().setFromProjectionMatrix(projection,camera.coordinateSystem,camera.reversedDepth);
  if(!frustum.intersectsBox(bounds))return 'outside';
  const point=new Vector3();
  for(const x of [bounds.min.x,bounds.max.x])for(const y of [bounds.min.y,bounds.max.y])
    for(const z of [bounds.min.z,bounds.max.z])if(!frustum.containsPoint(point.set(x,y,z)))return 'intersects';
  return 'inside';
}

/** Detached inspection camera, never changes the project's own camera. */
export function createInspectionCamera(original,{position,target,fov=45}={},aspect){
  const valid=v=>Array.isArray(v)&&v.length===3&&v.every(n=>Number.isFinite(n)&&Math.abs(n)<=1e6);
  if(!valid(position)||!valid(target)||!Number.isFinite(fov)||fov<10||fov>110||
     !Number.isFinite(aspect)||aspect<=0)throw fail('VISUAL_VIEW_INVALID');
  const eye=new Vector3(...position),focus=new Vector3(...target),delta=focus.clone().sub(eye);
  if(delta.lengthSq()<1e-12)throw fail('VISUAL_VIEW_INVALID');
  const distance=delta.length();
  const near=Math.max(1e-5,Math.min(original.near>0?original.near:0.01,distance/100));
  const far=Math.max(original.far>near&&Number.isFinite(original.far)?original.far:1000,distance*4,near*10);
  const camera=new PerspectiveCamera(fov,aspect,near,far);
  camera.layers.mask=original.layers.mask;
  camera.position.copy(eye);
  if(Math.abs(delta.normalize().y)>.999)camera.up.set(0,0,-1);
  camera.lookAt(focus);camera.updateMatrixWorld(true);
  return camera;
}

/** Fit an independent camera to the measured AABB, including depth of every corner. */
export function frameNativeView(native,{nodePath,direction=[1,.7,1],fov=45,padding=1.12}={},aspect){
  if(!Array.isArray(direction)||direction.length!==3||!direction.every(Number.isFinite)||
     !Number.isFinite(fov)||fov<10||fov>110||!Number.isFinite(padding)||padding<1.02||padding>2.5||
     !Number.isFinite(aspect)||aspect<=0)throw fail('VISUAL_VIEW_INVALID');
  const back=new Vector3(...direction);
  if(back.lengthSq()<1e-12||!Number.isFinite(back.lengthSq()))throw fail('VISUAL_VIEW_INVALID');
  back.normalize();
  const measured=inspectNativeScene(native,{nodePath,limit:1});
  if(!measured.boundsComplete)throw fail('VISUAL_FRAME_BOUNDS_INCOMPLETE');
  if(!measured.bounds)throw fail('VISUAL_FRAME_BOUNDS_EMPTY');
  const min=new Vector3(...measured.bounds.min),max=new Vector3(...measured.bounds.max);
  const box=new Box3(min,max),center=box.getCenter(new Vector3()),radius=box.getSize(new Vector3()).length()/2;
  const upHint=Math.abs(back.y)>.999?new Vector3(0,0,-1):new Vector3(0,1,0);
  const right=new Vector3().crossVectors(upHint,back).normalize(),up=new Vector3().crossVectors(back,right);
  const tanY=Math.tan(fov*Math.PI/360),tanX=tanY*aspect;
  let distance=1e-4;
  for(const x of [min.x,max.x])for(const y of [min.y,max.y])for(const z of [min.z,max.z]){
    const p=new Vector3(x,y,z).sub(center);
    distance=Math.max(distance,p.dot(back)+padding*Math.max(Math.abs(p.dot(right))/tanX,Math.abs(p.dot(up))/tanY));
  }
  distance+=Math.max(radius*.03,1e-4);
  return {nodePath,direction:back.toArray(),padding,fov,position:center.clone().addScaledVector(back,distance).toArray(),target:center.toArray()};
}

/** Read current geometry without requiring semantic registration or advancing the simulation. */
export function inspectNativeScene({scene,camera,renderer},{nodePath='',offset=0,limit=32,includeMaterials=false,includeLights=false,nodeBudget=MAX_NODES,vertexBudget=MAX_VERTICES,instanceBudget=MAX_INSTANCES,triangleBudget=MAX_TRIANGLES}={}){
  if(!scene?.isScene)throw fail('NATIVE_INSPECT_UNAVAILABLE');
  if(!Number.isSafeInteger(offset)||offset<0||!Number.isSafeInteger(limit)||limit<1||limit>64||
     !Number.isSafeInteger(nodeBudget)||nodeBudget<1||nodeBudget>MAX_NODES||
     !Number.isSafeInteger(vertexBudget)||vertexBudget<1||vertexBudget>MAX_VERTICES||
     !Number.isSafeInteger(instanceBudget)||instanceBudget<1||instanceBudget>MAX_INSTANCES||
     !Number.isSafeInteger(triangleBudget)||triangleBudget<1||triangleBudget>MAX_TRIANGLES)
    throw fail('NATIVE_INSPECT_PAGE_INVALID');
  const {node,visible}=resolveNode(scene,nodePath);
  const reasons=new Set(), cache=new WeakMap(), bounds=new Box3();
  const counts={nodes:0,vertices:0,meshes:0,visibleMeshes:0,instancedMeshes:0,instances:0,visibleInstances:0,
    otherRenderables:0,estimatedTriangles:0,estimatedLineSegments:0,estimatedPoints:0};
  let vertices=0,instances=0;
  const materialInventory=includeMaterials?createMaterialInventory():null;
  const lightingInventory=includeLights?createLightingInventory():null;
  const localBox=new Box3(),matrix=new Matrix4(),instanceMatrix=new Matrix4();
  const describe=(obj,path,shown)=>({nodePath:path,name:nameOf(obj),type:String(obj.type||'Object3D').slice(0,64),
    visible:shown,childCount:obj.children.length,...(obj.isInstancedMesh?{instances:obj.count}:{})});
  const geometryBounds=geometry=>{
    if(cache.has(geometry))return cache.get(geometry);
    const position=geometry?.attributes?.position;
    let box=null;
    if(!position||typeof position.getX!=='function'||!Number.isSafeInteger(position.count)||position.count<1)
      reasons.add('missing-position');
    else if(vertices+position.count>vertexBudget)reasons.add('vertex-budget');
    else{
      vertices+=position.count;counts.vertices+=position.count;
      const candidate=new Box3().setFromBufferAttribute(position);
      if(finiteBox(candidate))box=candidate;else reasons.add('invalid-geometry');
    }
    if(geometry)cache.set(geometry,box);
    return box;
  };
  const include=(box,transform)=>{
    localBox.copy(box).applyMatrix4(transform);
    if(finiteBox(localBox))bounds.union(localBox);else reasons.add('invalid-transform');
  };
  const visit=(obj,shown)=>{
    counts.nodes++;
    materialInventory?.add(obj,shown&&(!camera||camera.layers.test(obj.layers)));
    lightingInventory?.add(obj,shown&&(!camera||camera.layers.test(obj.layers)));
    if(!obj.isMesh){
      if(!shown||(camera&&!camera.layers.test(obj.layers)))return;
      if(obj.isLine||obj.isPoints){
        counts.otherRenderables++;
        const geometry=obj.geometry;
        const elements=geometry?.index?.count??geometry?.attributes?.position?.count??0;
        if(obj.isPoints)counts.estimatedPoints+=elements;
        else counts.estimatedLineSegments+=obj.isLineSegments?Math.floor(elements/2):
          obj.isLineLoop?elements:Math.max(0,elements-1);
        const materials=Array.isArray(obj.material)?obj.material:[obj.material];
        if(materials.some(m=>m?.isShaderMaterial||m?.displacementMap)||obj.morphTargetInfluences?.some(n=>n!==0))
          reasons.add('shader-deformation-unknown');
        // Bounds cover the geometric centerline/points, not screen-space stroke size.
        const box=geometryBounds(geometry);
        if(box)include(box,obj.matrixWorld);
      }else if(obj.isSprite){
        counts.otherRenderables++;reasons.add('non-mesh-renderable');
      }
      return;
    }
    counts.meshes++;
    const count=obj.isInstancedMesh?obj.count:1;
    if(obj.isInstancedMesh){
      counts.instancedMeshes++;counts.instances+=count;
      if(!Number.isSafeInteger(count)||count<0||instances+count>instanceBudget){reasons.add('instance-budget');return;}
      instances+=count;
    }
    if(!shown||(camera&&!camera.layers.test(obj.layers)))return;
    counts.visibleMeshes++;
    if(obj.isInstancedMesh)counts.visibleInstances+=count;
    const geometry=obj.geometry;
    const elements=geometry?.index?.count??geometry?.attributes?.position?.count??0;
    const estimatedTriangles=Math.floor(elements/3)*count;
    if(counts.estimatedTriangles+estimatedTriangles>triangleBudget){
      counts.estimatedTriangles=triangleBudget+1;reasons.add('triangle-budget');return;
    }
    counts.estimatedTriangles+=estimatedTriangles;
    if(obj.isSkinnedMesh||obj.isBatchedMesh||obj.morphTargetInfluences?.some(n=>n!==0)){
      reasons.add('deformed-mesh');return;
    }
    const materials=Array.isArray(obj.material)?obj.material:[obj.material];
    if(materials.some(m=>m?.isShaderMaterial||m?.displacementMap))reasons.add('shader-deformation-unknown');
    const box=geometryBounds(geometry);
    if(!box)return;
    if(!obj.isInstancedMesh){include(box,obj.matrixWorld);return;}
    for(let i=0;i<count;i++){
      obj.getMatrixAt(i,instanceMatrix);matrix.multiplyMatrices(obj.matrixWorld,instanceMatrix);include(box,matrix);
    }
  };

  // Update only visited transform caches; do not recurse through unbounded subtrees.
  node.updateWorldMatrix(true,false);
  visit(node,visible);
  const stack=[{node,visible,index:0}];
  while(stack.length){
    const parent=stack.at(-1);
    if(parent.index>=parent.node.children.length){stack.pop();continue;}
    if(counts.nodes>=nodeBudget){reasons.add('node-budget');break;}
    if(stack.length>=MAX_DEPTH){reasons.add('depth-budget');stack.pop();continue;}
    const child=parent.node.children[parent.index++], shown=parent.visible&&child.visible!==false;
    child.updateWorldMatrix(false,false);
    visit(child,shown);stack.push({node:child,visible:shown,index:0});
  }
  const complete=reasons.size===0;
  const children=node.children.slice(offset,offset+limit).map((child,index)=>
    describe(child,childPath(nodePath,offset+index),visible&&child.visible!==false));
  const frame=renderer?.info?.render;
  const renderStats=frame?Object.fromEntries(['calls','triangles','lines','points'].filter(key=>Number.isSafeInteger(frame[key])&&frame[key]>=0).map(key=>[key,frame[key]])):null;
  return {node:describe(node,nodePath,visible),counts,
    bounds:bounds.isEmpty()?null:{min:vector(bounds.min),max:vector(bounds.max),size:vector(bounds.getSize(new Vector3()))},
    boundsComplete:complete,limitations:[...reasons],cameraCoverage:cameraCoverage(camera,bounds,complete),
    camera:camera?.isCamera?{type:camera.type,position:vector(camera.getWorldPosition(new Vector3())),
      direction:vector(camera.getWorldDirection(new Vector3())),...(camera.isPerspectiveCamera?{fov:camera.fov,aspect:camera.aspect}:{})}:null,
    ...(materialInventory?{materials:materialInventory.result(!reasons.has('node-budget')&&!reasons.has('depth-budget'))}:{}),
    ...(lightingInventory?{lights:lightingInventory.result(!reasons.has('node-budget')&&!reasons.has('depth-budget'))}:{}),
    renderStats,children,offset,nextOffset:offset+children.length<node.children.length?offset+children.length:null};
}
