import {describe,it,expect} from 'vitest';
import * as T from 'three';
import {inspectNativeScene} from '../../application/native-scene/NativeSceneInspection.js';
import {sampleNativeVisibility,withNativeIsolation} from '../../application/native-scene/NativeSceneReview.js';

function fixture(){
  const scene=new T.Scene(),camera=new T.PerspectiveCamera(40,1,.1,100);
  camera.position.set(0,0,10);camera.lookAt(0,0,0);
  const target=new T.Mesh(new T.BoxGeometry(2,2,2),new T.MeshStandardMaterial({color:'#c08040',roughness:.35,metalness:.7}));
  target.name='Subject';scene.add(target);
  const wall=new T.Mesh(new T.BoxGeometry(5,5,.5),new T.MeshStandardMaterial());wall.name='Blocking wall';wall.position.z=3;scene.add(wall);
  const light=new T.DirectionalLight();scene.add(light);
  return {scene,camera,target,wall,light};
}
describe('native material and visibility diagnostics',()=>{
  it('reports actual material properties and texture dimensions without source or bytes',()=>{
    const native=fixture(),{scene,target}=native;
    const texture=new T.DataTexture(new Uint8Array(4*8*4),4,8);
    texture.name='wood grain';texture.colorSpace=T.SRGBColorSpace;
    texture.userData={secret:'not returned'};target.material.map=texture;
    const shared=new T.Mesh(new T.BoxGeometry(),target.material);shared.visible=false;scene.add(shared);
    const result=inspectNativeScene(native,{includeMaterials:true});
    expect(result.materials.truncated).toBe(false);
    expect(result.materials.items[0]).toMatchObject({type:'MeshStandardMaterial',color:'#c08040',roughness:.35,metalness:.7,objects:2,visibleObjects:1,textures:{map:{name:'wood grain',type:'DataTexture',width:4,height:8,colorSpace:T.SRGBColorSpace}}});
    expect(JSON.stringify(result.materials)).not.toContain('secret');
    expect(inspectNativeScene(native,{nodePath:'0'})).not.toHaveProperty('materials');
  });
  it('limits unique materials and distinguishes incomplete inventory',()=>{
    const scene=new T.Scene();
    for(let i=0;i<40;i++)scene.add(new T.Mesh(new T.BoxGeometry(),new T.MeshBasicMaterial()));
    const result=inspectNativeScene({scene,camera:new T.PerspectiveCamera()},{includeMaterials:true});
    expect(result.materials.items).toHaveLength(32);expect(result.materials.truncated).toBe(true);
  });
  it('detects an opaque wall despite the subject fitting within the camera frustum',()=>{
    const native=fixture(),{target,wall}=native;
    expect(inspectNativeScene(native,{nodePath:'0'}).cameraCoverage).toBe('inside');
    const blocked=sampleNativeVisibility(native,{nodePath:'0'});
    expect(blocked).toMatchObject({status:'sampled',samples:49,targetHits:49,occludedHits:49,visibleHits:0,visibleFraction:0,blockers:[{nodePath:'1',name:'Blocking wall',hits:49}]});
    wall.visible=false;
    expect(sampleNativeVisibility(native,{nodePath:'0'})).toMatchObject({status:'sampled',visibleFraction:1,occludedHits:0});
    wall.visible=true;wall.material.transparent=true;wall.material.opacity=.3;
    expect(sampleNativeVisibility(native,{nodePath:'0'})).toMatchObject({status:'partial',visibleFraction:1,limitations:['unsupported-occluder-renderable']});
    expect(target.visible).toBe(true);expect(wall.visible).toBe(true);
  });
  it('isolates selected descendants without hiding their parent subtree or lights and restores masks after failure',()=>{
    const {scene,target,wall,light}=fixture(),child=new T.Mesh(new T.BoxGeometry(),new T.MeshBasicMaterial());
    target.add(child);target.layers.enable(4);wall.layers.enable(2);
    const originals=[target.layers.mask,child.layers.mask,wall.layers.mask,light.layers.mask];
    expect(()=>withNativeIsolation(scene,'0/0',evidence=>{
      expect(evidence).toEqual({nodePath:'0/0',objectUuid:child.uuid,excludedRenderables:2});
      expect([target.layers.mask,child.layers.mask,wall.layers.mask,light.layers.mask]).toEqual([0,originals[1],0,originals[3]]);
      throw Error('RENDER_FAILED');
    })).toThrow('RENDER_FAILED');
    expect([target.layers.mask,child.layers.mask,wall.layers.mask,light.layers.mask]).toEqual(originals);
    expect(target.visible).toBe(true);
  });
  it('refuses to sample a target with unsupported/deformed geometry or excessive triangles',()=>{
    const native=fixture(),{target,scene}=native;
    target.material.transparent=true;
    expect(sampleNativeVisibility(native,{nodePath:'0'})).toMatchObject({status:'not-sampled',visibleFraction:null});
    target.material.transparent=false;
    scene.add(new T.Mesh(new T.PlaneGeometry(1,1,400,400),new T.MeshBasicMaterial()));
    const capped=sampleNativeVisibility(native,{nodePath:'0'});
    expect(capped.status).toBe('not-sampled');
    expect(capped.limitations).toContain('triangle-budget');
  });
});
