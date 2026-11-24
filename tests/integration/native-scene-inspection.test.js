import {describe,it,expect} from 'vitest';
import * as THREE from 'three';
import {inspectNativeScene,createInspectionCamera,frameNativeView} from '../../application/native-scene/NativeSceneInspection.js';
const mesh=()=>new THREE.Mesh(new THREE.BoxGeometry(1,1,1),new THREE.MeshBasicMaterial());
describe('bounded native Three.js inspection',()=>{
  it('creates a detached vertical camera without changing the authored camera',()=>{
    const primary=new THREE.PerspectiveCamera(70,1,.1,50);primary.position.set(1,2,3);
    const view=createInspectionCamera(primary,{position:[0,10,0],target:[0,0,0],fov:35},1.5);
    expect(view.position.toArray()).toEqual([0,10,0]);expect(view.fov).toBe(35);expect(view.aspect).toBe(1.5);
    expect(view.getWorldDirection(new THREE.Vector3()).y).toBeCloseTo(-1);
    expect(primary.position.toArray()).toEqual([1,2,3]);expect(primary.fov).toBe(70);
    expect(()=>createInspectionCamera(primary,{position:[0,0,0],target:[0,0,0]},1)).toThrow('VISUAL_VIEW_INVALID');
  });
  it('observes unregistered hierarchy, current world transforms and instanced geometry',()=>{
    const scene=new THREE.Scene(), tree=new THREE.Group();
    tree.name='Tree';tree.position.x=2;scene.add(tree);
    const trunk=mesh();trunk.name='Trunk';tree.add(trunk);
    const leaves=new THREE.InstancedMesh(trunk.geometry,trunk.material,2);
    leaves.name='Leaves';leaves.setMatrixAt(0,new THREE.Matrix4().makeTranslation(-3,1,0));
    leaves.setMatrixAt(1,new THREE.Matrix4().makeTranslation(4,2,0));tree.add(leaves);
    const hidden=mesh();hidden.visible=false;hidden.position.x=100;tree.add(hidden);
    const camera=new THREE.PerspectiveCamera(60,2,.1,100);camera.position.set(2,1,20);camera.lookAt(2,1,0);
    const native={scene,camera,renderer:{info:{render:{calls:3,triangles:36}}}};
    const root=inspectNativeScene(native,{limit:1});
    expect(root.children[0]).toMatchObject({nodePath:'0',name:'Tree',childCount:3});
    const detail=inspectNativeScene(native,{nodePath:'0',limit:1,offset:1});
    expect(detail.counts).toMatchObject({nodes:4,meshes:3,visibleMeshes:2,instances:2,visibleInstances:2,estimatedTriangles:36});
    expect(detail.bounds).toEqual({min:[-1.5,-.5,-.5],max:[6.5,2.5,.5],size:[8,3,1]});
    expect(detail.boundsComplete).toBe(true);
    expect(detail.cameraCoverage).toBe('inside');
    expect(detail.children[0]).toMatchObject({nodePath:'0/1',name:'Leaves',instances:2});
    expect(detail.nextOffset).toBe(2);
    expect(detail.renderStats).toEqual({calls:3,triangles:36});
    leaves.setMatrixAt(1,new THREE.Matrix4().makeTranslation(6,2,0));
    expect(inspectNativeScene(native,{nodePath:'0/1'}).bounds.max[0]).toBe(8.5);
    expect(inspectNativeScene(native,{nodePath:'0/2'}).bounds).toBeNull();
    expect(()=>inspectNativeScene(native,{nodePath:'0/9'})).toThrow('NATIVE_INSPECT_NODE_NOT_FOUND');
    expect(()=>inspectNativeScene(native,{nodePath:'../0'})).toThrow('NATIVE_INSPECT_PATH_INVALID');
    expect(()=>inspectNativeScene(native,{limit:65})).toThrow('NATIVE_INSPECT_PAGE_INVALID');
  });
  it('reports incomplete bounds rather than inventing evidence for excessive geometry or unsupported renderables',()=>{
    const scene=new THREE.Scene(), camera=new THREE.PerspectiveCamera();
    const instances=new THREE.InstancedMesh(new THREE.BoxGeometry(),new THREE.MeshBasicMaterial(),50001);
    scene.add(instances);
    scene.add(new THREE.Sprite(new THREE.SpriteMaterial()));
    const result=inspectNativeScene({scene,camera});
    expect(result.counts.instances).toBe(50001);
    expect(result.boundsComplete).toBe(false);
    expect(result.cameraCoverage).toBe('unknown');
    expect(result.limitations).toEqual(expect.arrayContaining(['instance-budget','non-mesh-renderable']));
    expect(result.bounds).toBeNull();
  });
  it('measures transformed line segments and points without inventing mesh triangles',()=>{
    const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera();
    const geom=new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(-2,0,0),new THREE.Vector3(2,1,0)]);
    const line=new THREE.LineSegments(geom,new THREE.LineBasicMaterial());line.position.y=2;scene.add(line);
    const points=new THREE.Points(geom,new THREE.PointsMaterial());points.position.z=3;scene.add(points);
    const r=inspectNativeScene({scene,camera});
    expect(r.boundsComplete).toBe(true);
    expect(r.bounds).toEqual({min:[-2,0,0],max:[2,3,3],size:[4,3,3]});
    expect(r.counts).toMatchObject({meshes:0,otherRenderables:2,estimatedTriangles:0,estimatedLineSegments:1,estimatedPoints:2});
  });
  it('auto-frames a selected subtree at wide and narrow aspects without altering the authored camera',()=>{
    const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(70,1,.1,100);
    camera.position.set(0,2,10);
    const g=new THREE.Group();g.position.set(3,1,-2);scene.add(g);
    const obj=mesh();obj.scale.set(8,1,2);obj.rotation.y=.37;g.add(obj);
    for(const aspect of [.5,2]){
      const native={scene,camera};
      const view=frameNativeView(native,{nodePath:'0',direction:[1,.7,1],padding:1.15},aspect);
      const inspection=createInspectionCamera(camera,view,aspect);
      expect(inspectNativeScene({...native,camera:inspection},{nodePath:'0'}).cameraCoverage).toBe('inside');
      expect(view.target[0]).toBeCloseTo(3,8);expect(view.target[1]).toBeCloseTo(1,8);expect(view.target[2]).toBeCloseTo(-2,8);
    }
    expect(camera.position.toArray()).toEqual([0,2,10]);
    expect(()=>frameNativeView({scene,camera},{nodePath:'0',direction:[0,0,0]},1)).toThrow('VISUAL_VIEW_INVALID');
    const sprite=new THREE.Sprite(new THREE.SpriteMaterial());g.add(sprite);
    expect(()=>frameNativeView({scene,camera},{nodePath:'0'},1)).toThrow('VISUAL_FRAME_BOUNDS_INCOMPLETE');
  });
  it('distinguishes offscreen bounds from merely intersecting camera bounds',()=>{
    const scene=new THREE.Scene(), camera=new THREE.PerspectiveCamera(45,1,.1,50), cube=mesh();
    camera.position.z=5;camera.lookAt(0,0,0);scene.add(cube);
    expect(inspectNativeScene({scene,camera}).cameraCoverage).toBe('inside');
    cube.position.x=20;
    expect(inspectNativeScene({scene,camera}).cameraCoverage).toBe('outside');
    cube.position.x=2;
    expect(inspectNativeScene({scene,camera}).cameraCoverage).toBe('intersects');
  });
});
