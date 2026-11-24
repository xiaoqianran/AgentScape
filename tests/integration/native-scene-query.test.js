import {describe,it,expect} from 'vitest';
import * as T from 'three';
import {searchNativeScene,inspectNativeSceneBatch,suggestNativeViews} from '../../application/native-scene/NativeSceneQuery.js';

function fixture(){
  const scene=new T.Scene(),camera=new T.PerspectiveCamera(45,1,.1,100);
  camera.position.set(0,0,10);camera.lookAt(0,0,0);camera.updateMatrixWorld(true);
  const room=new T.Group();room.name='Conference room';scene.add(room);
  const wood=new T.MeshStandardMaterial({color:'#9a6742',roughness:.4,metalness:.1});wood.name='Walnut finish';
  const table=new T.Mesh(new T.BoxGeometry(2,1,2),wood);table.name='Conference table';room.add(table);
  const hidden=new T.Mesh(new T.BoxGeometry(),new T.MeshBasicMaterial());hidden.name='Hidden chair';hidden.visible=false;room.add(hidden);
  const wall=new T.Mesh(new T.BoxGeometry(5,5,.5),new T.MeshStandardMaterial());wall.name='East wall';wall.position.z=3;scene.add(wall);
  const key=new T.DirectionalLight('#ffffff',2);key.name='Key light';key.position.set(2,5,4);key.castShadow=true;scene.add(key);
  const fill=new T.HemisphereLight('#dceeff','#4a392c',.6);fill.name='Fill light';scene.add(fill);
  const gizmo=new T.Group();gizmo.name='AgentScapeCodeWorldGizmo';gizmo.add(new T.Mesh(new T.BoxGeometry(),new T.MeshBasicMaterial()));scene.add(gizmo);
  return {scene,camera,renderer:null};
}

describe('native scene search, batch inspection and camera suggestions',()=>{
  it('searches actual names, Three types and material names with stable paginated paths',()=>{
    const native=fixture();
    const name=searchNativeScene(native,{query:'conference table'});
    expect(name.items).toMatchObject([{nodePath:'0/0',name:'Conference table',type:'Mesh',visible:true,materialNames:['Walnut finish']}]);
    const byMaterial=searchNativeScene(native,{material:'WALNUT',objectType:'Mesh'});
    expect(byMaterial.items[0].nodePath).toBe('0/0');
    expect(searchNativeScene(native,{query:'chair'}).items[0]).toMatchObject({name:'Hidden chair',visible:false});
    expect(searchNativeScene(native,{query:'chair',visibleOnly:true}).items).toHaveLength(0);
    expect(searchNativeScene(native,{objectType:'Mesh'}).items.some(item=>item.nodePath.startsWith('4/'))).toBe(false);
    expect(searchNativeScene(native,{objectType:'Mesh',includeInternal:true}).items.some(item=>item.nodePath.startsWith('4/'))).toBe(true);
    expect(()=>searchNativeScene(native,{})).toThrow('NATIVE_SEARCH_QUERY_REQUIRED');
    const paged=searchNativeScene(native,{objectType:'Mesh',limit:1});
    expect(paged.items).toHaveLength(1);expect(paged.nextOffset).toBe(1);
    expect(searchNativeScene(native,{objectType:'Mesh',limit:1,offset:1}).items).toHaveLength(1);
  });

  it('batch-inspects multiple paths, returns material and light metadata and enforces request bounds',()=>{
    const native=fixture();
    const result=inspectNativeSceneBatch(native,{nodePaths:['','0/0','2'],includeMaterials:true,includeLights:true});
    expect(result).toMatchObject({status:'batch-inspected',count:3,budgets:{maxPaths:8,maxNodes:8192,visibilityPaths:4}});
    expect(result.results[1].materials.items[0]).toMatchObject({name:'Walnut finish',roughness:.4});
    expect(result.results[0].lights.items).toEqual(expect.arrayContaining([
      expect.objectContaining({name:'Key light',type:'DirectionalLight',intensity:2,castShadow:true}),
      expect.objectContaining({name:'Fill light',type:'HemisphereLight',groundColor:'#4a392c'})
    ]));
    const visibility=inspectNativeSceneBatch(native,{nodePaths:['0/0','2'],visibility:true});
    expect(visibility.results[0].visibility).toMatchObject({status:'sampled',targetHits:49,occludedHits:49});
    expect(()=>inspectNativeSceneBatch(native,{nodePaths:Array.from({length:9},(_,i)=>String(i))})).toThrow('NATIVE_BATCH_PATHS_INVALID');
    expect(()=>inspectNativeSceneBatch(native,{nodePaths:['0/0','2','0/0']})).toThrow('NATIVE_BATCH_PATHS_INVALID');
    expect(()=>inspectNativeSceneBatch(native,{nodePaths:['0/0','2','0/0','2','0/0'],visibility:true})).toThrow('NATIVE_BATCH_PATHS_INVALID');
  });

  it('ranks candidate views using measured occlusion and returns a reproducible best camera',()=>{
    const native=fixture();
    const result=suggestNativeViews(native,{nodePath:'0/0',candidateLimit:2,directions:[[0,0,1],[0,0,-1]]},1);
    expect(result.status).toBe('views-suggested');
    expect(result.candidates).toHaveLength(2);
    expect(result.candidates[0].visibility.visibleFraction).toBe(1);
    expect(result.candidates[1].visibility.visibleFraction).toBe(0);
    expect(result.best.rank).toBe(1);
    expect(result.best.view).toMatchObject({nodePath:'0/0',direction:[0,0,-1],fov:45,padding:1.15});
    expect(native.camera.position.toArray()).toEqual([0,0,10]);
    expect(()=>suggestNativeViews(native,{nodePath:'0/0',candidateLimit:1},1)).toThrow('VISUAL_CANDIDATES_INVALID');
  });
});
