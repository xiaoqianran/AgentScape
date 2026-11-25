import { expect,it } from 'vitest';
import * as THREE from 'three';
import { exportSceneGLB } from '../../application/world-authoring/SceneGLBExport.js';
import { installHeadlessAssetIO } from '../../apps/mcp-server/HeadlessAssetIO.js';
import { createHeadlessGLTFLoader } from '../../apps/mcp-server/HeadlessGLTFLoader.js';
import { installHeadlessImageSupport } from '../../application/world-authoring/HeadlessImageExport.js';

installHeadlessAssetIO();
const options={camera:{position:[4,3,6],target:[0,0,0],fov:40,aspect:1.5},lights:[
  {type:'directional',name:'Sun',position:[3,5,2],target:[0,0,0],intensity:3},
  {type:'point',name:'Fill',position:[0,3,1],intensity:10,distance:8},
  {type:'spot',name:'Spot',position:[1,5,0],target:[0,0,0],intensity:20,angle:.4,penumbra:.2}
]};
function fixture(){
  const parent=new THREE.Group();parent.position.set(10,0,0);
  const mesh=new THREE.Mesh(new THREE.BoxGeometry(),new THREE.MeshPhysicalMaterial({
    color:0x875533,roughness:.42,metalness:.15,clearcoat:.7,
    map:new THREE.DataTexture(new Uint8Array([255,0,0,255,0,255,0,255]),2,1)
  }));
  mesh.userData={private:'not for export'};
  mesh.position.set(1,2,3);parent.add(mesh);
  return {mesh,parent,world:{store:new Map([['wood',{object:mesh}]])}};
}
function jsonOf(bytes){
  const data=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  expect(data.getUint32(0,true)).toBe(0x46546c67);
  return JSON.parse(new TextDecoder().decode(bytes.subarray(20,20+data.getUint32(12,true))));
}

it('exports actual PBR texture, world transform, camera and three punctual lights without changing live objects',async()=>{
  const {mesh,parent,world}=fixture();
  const result=await exportSceneGLB(world,options);
  const json=jsonOf(result.bytes);
  expect(result.summary).toMatchObject({meshes:1,materials:1,textures:1,cameras:1,lights:3});
  expect(json.materials[0].pbrMetallicRoughness).toMatchObject({roughnessFactor:.42,metallicFactor:.15,baseColorTexture:{index:0}});
  expect(json.materials[0].extensions.KHR_materials_clearcoat.clearcoatFactor).toBe(.7);
  expect(json.cameras[0].perspective).toMatchObject({aspectRatio:1.5,yfov:40*Math.PI/180});
  expect(json.extensions.KHR_lights_punctual.lights.map(l=>l.type)).toEqual(['directional','point','spot']);
  expect(JSON.stringify(json)).not.toContain('not for export');
  const scene=await createHeadlessGLTFLoader().loadBytes(result.bytes);
  const wood=scene.getObjectByName('wood');
  expect(wood.position.toArray()).toEqual([11,2,3]);
  expect([...wood.material.map.image.data]).toEqual([255,0,0,255,0,255,0,255]);
  const camera=scene.getObjectByName('Camera');
  expect(camera.getWorldDirection(new THREE.Vector3()).distanceTo(new THREE.Vector3(-4,-3,-6).normalize())).toBeLessThan(1e-6);
  const sun=scene.getObjectByName('Sun');
  expect(sun.target.getWorldPosition(new THREE.Vector3()).sub(sun.getWorldPosition(new THREE.Vector3())).normalize().distanceTo(new THREE.Vector3(-3,-5,-2).normalize())).toBeLessThan(1e-6);
  expect(mesh.parent).toBe(parent);
  expect(mesh.position.toArray()).toEqual([1,2,3]);
  expect(mesh.userData.private).toBe('not for export');
});

it('rejects invalid camera, duplicate selection and unsupported shader rather than silently exporting',async()=>{
  const {world,mesh}=fixture();
  await expect(exportSceneGLB(world,{camera:{position:[0,0,0],target:[0,0,0]}})).rejects.toMatchObject({code:'SCENE_EXPORT_DIRECTION_INVALID'});
  await expect(exportSceneGLB(world,{objectIds:['wood','wood']})).rejects.toMatchObject({code:'SCENE_EXPORT_SELECTION_INVALID'});
  mesh.material=new THREE.ShaderMaterial();
  await expect(exportSceneGLB(world)).rejects.toMatchObject({code:'SCENE_EXPORT_MATERIAL_UNSUPPORTED'});
});

it('keeps the shared headless image adapter alive across concurrent exports',async()=>{
  const scope={};
  const first=installHeadlessImageSupport(scope),second=installHeadlessImageSupport(scope);
  first();first();
  expect(scope.OffscreenCanvas).toBeTypeOf('function');
  second();
  expect(scope.OffscreenCanvas).toBeUndefined();
  const a=fixture(),b=fixture();
  const results=await Promise.all([exportSceneGLB(a.world),exportSceneGLB(b.world)]);
  for(const result of results)expect(jsonOf(result.bytes).images).toHaveLength(1);
});
