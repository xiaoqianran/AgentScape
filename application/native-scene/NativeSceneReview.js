import { Mesh, Raycaster, Vector2, Vector3 } from 'three';
import { inspectNativeScene, resolveNode } from './NativeSceneInspection.js';

const fail=code=>Object.assign(new Error(code),{code});
const MAX_NODES=4096,MAX_DEPTH=128,MAX_TRIANGLES=200_000,MAX_VERTICES=1_000_000,GRID=7;
const renderable=o=>o.isMesh||o.isLine||o.isPoints||o.isSprite;

/** Bounded preorder walk. Avoid allocating every child of an enormous scene. */
function walk(scene,target,visit,maxNodes=MAX_NODES,maxDepth=MAX_DEPTH){
  const stack=[{object:scene,path:'',inside:scene===target,visible:scene.visible!==false,index:-1}];
  let count=0;
  while(stack.length){
    const item=stack.at(-1);
    if(item.index===-1){
      if(++count>maxNodes)return false;
      if(visit(item)===false)return false;
      item.index=0;
    }else if(item.index>=item.object.children.length)stack.pop();
    else{
      if(stack.length>=maxDepth)return false;
      const i=item.index++,object=item.object.children[i];
      stack.push({object,path:item.path?item.path+'/'+i:String(i),inside:item.inside||object===target,
        visible:item.visible&&object.visible!==false,index:-1});
    }
  }
  return true;
}

/** Temporary render-only layer mask. Preserve every original layer and light,
 * including mesh parents of selected descendants. Always restore on failure. */
export function withNativeIsolation(scene,nodePath,render,objectUuid){
  const {node}=resolveNode(scene,nodePath,objectUuid);
  const changes=[];
  const complete=walk(scene,node,({object,inside})=>{
    if(!inside&&renderable(object)&&object.layers.mask!==0)changes.push([object,object.layers.mask]);
  });
  if(!complete)throw fail('VISUAL_ISOLATION_BUDGET');
  try{
    for(const [object] of changes)object.layers.mask=0;
    return render({nodePath,objectUuid:node.uuid,excludedRenderables:changes.length});
  }finally{
    for(const [object,mask] of changes)object.layers.mask=mask;
  }
}

function screenRectangle(camera,bounds){
  const min=new Vector3(...bounds.min),max=new Vector3(...bounds.max);
  const point=new Vector3(),local=new Vector3();
  let left=Infinity,right=-Infinity,bottom=Infinity,top=-Infinity;
  for(const x of [min.x,max.x])for(const y of [min.y,max.y])for(const z of [min.z,max.z]){
    point.set(x,y,z);local.copy(point).applyMatrix4(camera.matrixWorldInverse);
    if(local.z>=-camera.near)return null;
    point.project(camera);
    left=Math.min(left,point.x);right=Math.max(right,point.x);
    bottom=Math.min(bottom,point.y);top=Math.max(top,point.y);
  }
  return {left:Math.max(-1,left),right:Math.min(1,right),bottom:Math.max(-1,bottom),top:Math.min(1,top)};
}
const opaqueMaterial=m=>m?.isMaterial&&m.visible!==false&&!m.transparent&&!(m.opacity<1)&&
  !(m.alphaTest>0)&&!m.alphaMap&&!m.isShaderMaterial&&!m.isRawShaderMaterial&&!(m.transmission>0)&&
  m.depthWrite!==false&&m.depthTest!==false&&!m.displacementMap&&!m.clippingPlanes?.length;
const supported=o=>o.isMesh&&!o.isInstancedMesh&&!o.isSkinnedMesh&&!o.isBatchedMesh&&
  o.raycast===Mesh.prototype.raycast&&!o.morphTargetInfluences?.some(n=>n!==0)&&
  o.geometry?.isBufferGeometry&&o.geometry.attributes.position?.count>0&&
  (Array.isArray(o.material)?o.material.length>0&&o.material.length<=16&&o.material.every(opaqueMaterial):opaqueMaterial(o.material));

/** Geometric, opaque-mesh ray samples, NOT pixel coverage, transparency,
 * shader visibility or an acceptance verdict. No render/material mutation. */
export function sampleNativeVisibility(native,{nodePath='',objectUuid,measured,maxNodes=MAX_NODES,maxDepth=MAX_DEPTH,maxTriangles=MAX_TRIANGLES,maxVertices=MAX_VERTICES,grid=GRID}={}){
  const {scene,camera,renderer}=native;
  if(!Number.isSafeInteger(grid)||grid<3||grid>GRID)throw fail('VISUAL_GRID_INVALID');
  const base={method:'opaque-mesh-ray-samples',grid,samples:0,targetHits:0,visibleHits:0,occludedHits:0,
    visibleFraction:null,blockers:[],limitations:[]};
  const unavailable=reason=>({...base,status:'not-sampled',limitations:[reason]});
  if(!camera?.isPerspectiveCamera&&!camera?.isOrthographicCamera)return unavailable('unsupported-camera');
  const {node}=resolveNode(scene,nodePath,objectUuid);
  measured??=inspectNativeScene(native,{nodePath,objectUuid,limit:1});
  if(!measured.boundsComplete)return unavailable('incomplete-bounds');
  if(!measured.bounds)return unavailable('empty-bounds');
  if(measured.cameraCoverage==='outside')return unavailable('outside-frustum');
  camera.updateWorldMatrix(true,false);
  const rect=screenRectangle(camera,measured.bounds);
  if(!rect)return unavailable('bounds-cross-near-plane');
  if(rect.right<=rect.left||rect.top<=rect.bottom)return unavailable('empty-screen-rectangle');
  const targets=[],others=[],paths=new Map(),limitations=new Set();
  if(renderer?.clippingPlanes?.length)limitations.add('global-clipping-not-modeled');
  let triangles=0,vertices=0;
  const complete=walk(scene,node,({object,inside,path,visible})=>{
    object.updateWorldMatrix(false,false);
    if(!visible||!renderable(object)||!camera.layers.test(object.layers))return;
    if(!supported(object)){limitations.add(inside?'unsupported-target-renderable':'unsupported-occluder-renderable');return;}
    const elements=object.geometry.index?.count??object.geometry.attributes.position.count;
    triangles+=Math.floor(elements/3);vertices+=object.geometry.attributes.position.count;
    if(vertices>maxVertices){limitations.add('vertex-budget');return false;}
    if(triangles>maxTriangles){limitations.add('triangle-budget');return false;}
    (inside?targets:others).push(object);paths.set(object,{nodePath:path,objectUuid:object.uuid,name:String(object.name||'').slice(0,120)});
  },maxNodes,maxDepth);
  if(!complete)limitations.add('traversal-budget');
  if(!targets.length||!complete)return {...base,status:'not-sampled',limitations:[...limitations,...(!targets.length?['no-supported-target-mesh']:[])]};
  const ray=new Raycaster(),uv=new Vector2(),hits=new Map();
  ray.layers.mask=camera.layers.mask;
  const point=new Vector3();
  ray.near=camera.near;ray.far=camera.far;
  const intersections=[];
  const nearest=objects=>{
    let best=null;
    for(const object of objects){
      intersections.length=0;object.raycast(ray,intersections);
      for(const hit of intersections){
        point.copy(hit.point).applyMatrix4(camera.matrixWorldInverse);
        if(-point.z<camera.near||-point.z>camera.far)continue;
        if(!best||hit.distance<best.distance)best=hit;
      }
    }
    return best;
  };
  for(let y=0;y<grid;y++)for(let x=0;x<grid;x++){
    uv.set(rect.left+(x+.5)/grid*(rect.right-rect.left),rect.bottom+(y+.5)/grid*(rect.top-rect.bottom));
    ray.setFromCamera(uv,camera);base.samples++;
    const subject=nearest(targets);
    if(!subject)continue;
    base.targetHits++;
    const blocker=nearest(others);
    if(blocker&&blocker.distance<subject.distance-Math.max(1e-6,subject.distance*1e-6)){
      base.occludedHits++;hits.set(blocker.object,(hits.get(blocker.object)||0)+1);
    }else base.visibleHits++;
  }
  base.visibleFraction=base.targetHits?base.visibleHits/base.targetHits:null;
  base.blockers=[...hits.entries()].sort((a,b)=>b[1]-a[1]).slice(0,8).map(([object,hits])=>({...paths.get(object),hits}));
  return {...base,status:base.targetHits?(limitations.size?'partial':'sampled'):'not-sampled',
    limitations:[...limitations,...(!base.targetHits?['no-target-ray-hit']:[])]};
}
