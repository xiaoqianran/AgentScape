import { Vector3 } from 'three';
import { createInspectionCamera, frameNativeView, inspectNativeScene } from './NativeSceneInspection.js';
import { sampleNativeVisibility } from './NativeSceneReview.js';

const MAX_SEARCH_NODES=8192,MAX_DEPTH=128;
const fail=code=>Object.assign(new Error(code),{code});
const lower=value=>String(value??'').trim().toLocaleLowerCase();
const matches=(value,query)=>!query||lower(value).includes(query);
const materialsOf=object=>(Array.isArray(object.material)?object.material.slice(0,8):[object.material])
  .filter(material=>material?.isMaterial);
const materialLabels=object=>materialsOf(object).slice(0,8).map(material=>String(material.name||material.type||'Material').slice(0,80));

/** Search actual native Object3D nodes. Paths are runtime-local child indices. */
export function searchNativeScene({scene},{query='',objectType='',material='',visibleOnly=false,includeInternal=false,offset=0,limit=32}={}){
  if(!scene?.isScene)throw fail('NATIVE_INSPECT_UNAVAILABLE');
  const q=lower(query),type=lower(objectType),mat=lower(material);
  if(!q&&!type&&!mat)throw fail('NATIVE_SEARCH_QUERY_REQUIRED');
  if(q.length>120||type.length>64||mat.length>120)throw fail('NATIVE_SEARCH_QUERY_INVALID');
  if(!Number.isSafeInteger(offset)||offset<0||offset>MAX_SEARCH_NODES||
     !Number.isSafeInteger(limit)||limit<1||limit>64)throw fail('NATIVE_SEARCH_PAGE_INVALID');
  const items=[],position=new Vector3(),stack=[{object:scene,path:'',visible:scene.visible!==false,index:-1,depth:0}];
  let scannedNodes=0,totalMatches=0,truncated=false;
  scene.updateWorldMatrix(true,false);
  while(stack.length){
    const item=stack.at(-1);
    if(item.index===-1){
      if(scannedNodes>=MAX_SEARCH_NODES){truncated=true;break;}
      scannedNodes++;item.object.updateWorldMatrix(false,false);
      const object=item.object;
      const internal=object.userData?.agentscapeInternal===true||object.userData?.editorOverlay===true||
        object.name==='AgentScapeCodeWorldGizmo'||object.name==='AgentScapeCodeWorldEditOutline';
      if(internal&&!includeInternal){item.index=object.children.length;continue;}
      const labels=materialLabels(object);
      const searchable=[object.name,object.type,...labels].join(' ');
      if(matches(searchable,q)&&matches(object.type,type)&&matches(labels.join(' '),mat)&&(!visibleOnly||item.visible)){
        if(totalMatches>=offset&&items.length<limit){
          object.getWorldPosition(position);
          const geometry=object.geometry,vertices=geometry?.attributes?.position?.count??null;
          const elements=geometry?.index?.count??vertices;
          items.push({nodePath:item.path,name:String(object.name||'').slice(0,120),
            type:String(object.type||'Object3D').slice(0,64),visible:item.visible,
            childCount:object.children.length,renderable:Boolean(object.isMesh||object.isLine||object.isPoints||object.isSprite),
            worldPosition:[position.x,position.y,position.z].map(n=>Number.isFinite(n)?Number(n.toPrecision(8)):null),
            materialNames:labels,...(geometry?{geometry:{vertices,estimatedTriangles:Number.isSafeInteger(elements)?Math.floor(elements/3):null,
              ...(object.isInstancedMesh?{instances:object.count}:{})}}:{})});
        }
        totalMatches++;
      }
      item.index=0;
    }else if(item.index>=item.object.children.length)stack.pop();
    else{
      if(item.depth>=MAX_DEPTH){truncated=true;stack.pop();continue;}
      const index=item.index++,child=item.object.children[index];
      stack.push({object:child,path:item.path?item.path+'/'+index:String(index),
        visible:item.visible&&child.visible!==false,index:-1,depth:item.depth+1});
    }
  }
  const hasNext=items.length===limit&&(totalMatches>offset+items.length||truncated);
  return {status:'searched',query,objectType,material,visibleOnly,includeInternal,scannedNodes,totalMatches,
    truncated,items,nextOffset:hasNext?offset+items.length:null};
}

/** Inspect a bounded set of known native paths in one synchronous scene snapshot. */
export function inspectNativeSceneBatch(native,{nodePaths,includeMaterials=false,includeLights=false,visibility=false}={}){
  if(!Array.isArray(nodePaths)||nodePaths.length<1||nodePaths.length>8||
     nodePaths.some(path=>typeof path!=='string'||path.length>256)||new Set(nodePaths).size!==nodePaths.length)
    throw fail('NATIVE_BATCH_PATHS_INVALID');
  if(visibility&&nodePaths.length>4)throw fail('NATIVE_BATCH_VISIBILITY_LIMIT');
  const results=[],totals={nodes:0,vertices:0,estimatedTriangles:0,instances:0};
  for(let index=0;index<nodePaths.length;index++){
    const nodePath=nodePaths[index];
    try{
      const evidence=inspectNativeScene(native,{nodePath,limit:1,includeMaterials,includeLights,
        nodeBudget:1024,vertexBudget:187_500,instanceBudget:6250,triangleBudget:62_500});
      for(const key of Object.keys(totals))totals[key]+=evidence.counts[key]||0;
      const item={index,nodePath,status:'inspected',...evidence};
      if(visibility)item.visibility=sampleNativeVisibility(native,{nodePath,measured:evidence,
        maxNodes:4096,maxTriangles:50_000,maxVertices:187_500});
      results.push(item);
    }catch(error){results.push({index,nodePath,status:'error',code:error.code||'NATIVE_INSPECT_FAILED'});}
  }
  return {status:'batch-inspected',count:results.length,totals,results,
    budgets:{maxPaths:8,maxNodes:8192,maxVertices:1_500_000,maxTriangles:500_000,maxInstances:50_000,
      visibilityPaths:4}};
}

/** Rank reproducible independent cameras using bounded opaque-mesh ray samples. */
export function suggestNativeViews(native,{nodePath,candidateLimit=8,fov=45,padding=1.15,grid=5,directions}={},aspect){
  if(typeof nodePath!=='string'||nodePath.length>256||!Number.isSafeInteger(candidateLimit)||candidateLimit<2||candidateLimit>12||
     !Number.isFinite(fov)||fov<10||fov>110||!Number.isFinite(padding)||padding<1.02||padding>2.5||
     !Number.isFinite(aspect)||aspect<=0||!Number.isSafeInteger(grid)||grid<3||grid>7)throw fail('VISUAL_CANDIDATES_INVALID');
  const defaults=Array.from({length:8},(_,i)=>{const a=i*Math.PI/4;return [Math.cos(a),.48,Math.sin(a)];})
    .concat([[1,1.35,1],[-1,1.35,1],[1,1.35,-1],[-1,1.35,-1]]);
  const selected=(directions??defaults).slice(0,candidateLimit);
  if(!Array.isArray(selected)||selected.length<2||selected.length>12||
     selected.some(v=>!Array.isArray(v)||v.length!==3||!v.every(Number.isFinite)))
    throw fail('VISUAL_CANDIDATES_INVALID');
  const candidates=[];
  for(let index=0;index<selected.length;index++){
    try{
      const view=frameNativeView(native,{nodePath,direction:selected[index],fov,padding},aspect);
      const camera=createInspectionCamera(native.camera,view,aspect);
      const candidateNative={...native,camera};
      const measured=inspectNativeScene(candidateNative,{nodePath,limit:1});
      const visibility=sampleNativeVisibility(candidateNative,{nodePath,measured,maxNodes:4096,maxTriangles:300_000,maxVertices:1_000_000,grid});
      const score=visibility.visibleFraction===null?null:
        Number((visibility.visibleFraction*100+visibility.targetHits/visibility.samples*.01-visibility.blockers.length*.25).toFixed(3));
      candidates.push({index,score,view,cameraCoverage:measured.cameraCoverage,visibility});
    }catch(error){candidates.push({index,score:null,status:'error',code:error.code||'VISUAL_CANDIDATE_FAILED'});}
  }
  candidates.sort((a,b)=>(b.score??-1)-(a.score??-1)||
    (b.visibility?.visibleHits??0)-(a.visibility?.visibleHits??0)||
    (a.visibility?.occludedHits??Infinity)-(b.visibility?.occludedHits??Infinity)||a.index-b.index);
  const ranked=candidates.map((candidate,index)=>({...candidate,rank:index+1}));
  return {status:'views-suggested',nodePath,best:ranked.find(candidate=>candidate.score!==null)||null,candidates:ranked,
    scoring:'visible opaque-mesh ray fraction; tie-break by more target hits and fewer sampled blockers',grid,
    limitations:['49-point projected-AABB sampling, not pixel visibility','transparent, shader, skinned, instanced and custom-raycast meshes may be partial or unsupported',
      'candidate cameras use direct rendering and do not include custom postprocessing']};
}
