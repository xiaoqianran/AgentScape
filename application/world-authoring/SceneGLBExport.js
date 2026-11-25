import * as THREE from 'three';
import * as z from 'zod/v4';
import { installHeadlessImageSupport } from './HeadlessImageExport.js';

const vector=z.tuple([z.number().finite(),z.number().finite(),z.number().finite()]);
const name=z.string().trim().min(1).max(100);
const color=z.string().regex(/^#[a-fA-F0-9]{6}$/);
const lightBase={name:name.optional(),color:color.default('#ffffff'),intensity:z.number().finite().min(0).max(100000),position:vector};
const directed={target:vector};
const lightSchema=z.discriminatedUnion('type',[
  z.object({...lightBase,...directed,type:z.literal('directional')}).strict(),
  z.object({...lightBase,type:z.literal('point'),distance:z.number().finite().min(0).default(0)}).strict(),
  z.object({...lightBase,...directed,type:z.literal('spot'),distance:z.number().finite().min(0).default(0),
    angle:z.number().positive().max(Math.PI/2).default(Math.PI/4),penumbra:z.number().min(0).max(1).default(0)}).strict()
]);
export const sceneGLBOptions=z.object({
  objectIds:z.array(name).min(1).max(128).optional(),
  camera:z.object({name:name.default('Camera'),position:vector,target:vector,fov:z.number().min(10).max(110).default(45),
    aspect:z.number().positive().max(10).default(16/9),near:z.number().positive().default(.1),far:z.number().positive().default(1000)}).strict().optional(),
  lights:z.array(lightSchema).max(16).default([])
}).strict();
const fail=code=>Object.assign(new Error(code),{code});
function aim(object,target){
  const point=new THREE.Vector3(...target);
  if(object.position.distanceToSquared(point)<1e-12)throw fail('SCENE_EXPORT_DIRECTION_INVALID');
  object.lookAt(point);
  if(object.target){object.target.position.set(0,0,-1);object.add(object.target);}
}

/** Export current active managed visual entities, not the simulation or editor.
 * A detached scene owns the export camera and lights, so no live state is changed. */
export async function exportSceneGLB(world,input={}){
  const options=sceneGLBOptions.parse(input);
  const ids=options.objectIds??Array.from(world.store.entries(),([id,record])=>record.active===false?null:id).filter(Boolean);
  if(!ids.length||ids.length>128||new Set(ids).size!==ids.length)throw fail('SCENE_EXPORT_SELECTION_INVALID');
  const scene=new THREE.Scene();
  const warnings=new Set();let nodes=0,vertices=0,meshes=0,pixels=0;
  const materials=new Set(),textures=new Set(),geometries=new Set();
  function copy(node){
    if(node.visible===false||node.userData?.agentscapeInternal===true||node.userData?.editorOverlay===true)return null;
    if(++nodes>20000)throw fail('SCENE_EXPORT_LIMIT');
    if(node.isSkinnedMesh||node.isBatchedMesh||node.isLight||node.isCamera||node.isSprite||node.isLOD)throw fail('SCENE_EXPORT_OBJECT_UNSUPPORTED');
    if(node.animations?.length)warnings.add('Animations omitted; exports a static scene.');
    if(node.geometry&&!geometries.has(node.geometry)){
      geometries.add(node.geometry);vertices+=node.geometry.attributes?.position?.count??0;
      if(vertices>3000000)throw fail('SCENE_EXPORT_LIMIT');
    }
    if(node.isMesh)meshes++;
    for(const material of Array.isArray(node.material)?node.material:[node.material]){
      if(!material||materials.has(material))continue;
      materials.add(material);
      if(material.isShaderMaterial||material.isRawShaderMaterial||material.isNodeMaterial)throw fail('SCENE_EXPORT_MATERIAL_UNSUPPORTED');
      if(!material.isMeshStandardMaterial&&!material.isMeshBasicMaterial)warnings.add('Non-PBR materials may be approximated by glTF.');
      if(material.roughnessMap!==material.metalnessMap&&(material.roughnessMap||material.metalnessMap))throw fail('SCENE_EXPORT_TEXTURE_UNSUPPORTED');
      for(const texture of Object.values(material)){
        if(!texture?.isTexture||textures.has(texture))continue;
        textures.add(texture);
        if(!texture.isDataTexture||texture.format!==THREE.RGBAFormat||texture.type!==THREE.UnsignedByteType||
          !Number.isSafeInteger(texture.image?.width)||!Number.isSafeInteger(texture.image?.height)||
          texture.image.width*texture.image.height>65536)throw fail('SCENE_EXPORT_TEXTURE_UNSUPPORTED');
        pixels+=texture.image.width*texture.image.height;
        if(pixels>4000000)throw fail('SCENE_EXPORT_LIMIT');
      }
      if(material.envMap||material.lightMap||material.bumpMap||material.displacementMap)warnings.add('Environment, light, bump or displacement maps may not transfer to glTF.');
    }
    const clone=node.clone(false);
    clone.userData={};clone.animations=[];
    for(const child of node.children){const item=copy(child);if(item)clone.add(item);}
    return clone;
  }
  for(const id of ids){
    if(!world.store.has(id))throw fail('SCENE_EXPORT_SELECTION_INVALID');
    const record=world.store.get(id);
    if(record.active===false)throw fail('SCENE_EXPORT_SELECTION_INVALID');
    const source=record.object;
    source.updateWorldMatrix(true,true);
    const root=copy(source);
    if(!root)continue;
    root.name=id;root.matrix.copy(source.matrixWorld);root.matrixAutoUpdate=false;
    scene.add(root);
  }
  if(!meshes)throw fail('SCENE_EXPORT_EMPTY');
  if(options.camera){
    const c=options.camera;
    if(c.far<=c.near)throw fail('SCENE_EXPORT_CAMERA_INVALID');
    const camera=new THREE.PerspectiveCamera(c.fov,c.aspect,c.near,c.far);
    camera.name=c.name;camera.position.fromArray(c.position);aim(camera,c.target);scene.add(camera);
  }
  for(const l of options.lights){
    const light=l.type==='directional'?new THREE.DirectionalLight(l.color,l.intensity):
      l.type==='point'?new THREE.PointLight(l.color,l.intensity,l.distance,2):
      new THREE.SpotLight(l.color,l.intensity,l.distance,l.angle,l.penumbra,2);
    light.name=l.name??l.type;light.position.fromArray(l.position);
    if(l.target)aim(light,l.target);
    scene.add(light);
  }
  const {GLTFExporter}=await import('three/addons/exporters/GLTFExporter.js');
  const restore=installHeadlessImageSupport();
  try{
    const bytes=new Uint8Array(await new GLTFExporter().parseAsync(scene,{binary:true,onlyVisible:true}));
    return {bytes,summary:{format:'glb',coordinateSystem:'Y-up',scope:'managed-visual-entities',
      objectIds:ids,meshes,materials:materials.size,textures:textures.size,cameras:options.camera?1:0,lights:options.lights.length,
      warnings:[...warnings,'Static visual export: environment, physics, behavior and editor state are not included.']}};
  }finally{restore?.();}
}
