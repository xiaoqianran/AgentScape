import * as THREE from 'three';
import * as z from 'zod/v4';
import { installHeadlessImageSupport } from './HeadlessImageExport.js';

import { buildPresentationGroup, presentationCameraSchema, presentationLightsSchema } from '../../modules/world/runtime/ScenePresentation.js';

const name=z.string().trim().min(1).max(100);
export const sceneGLBOptions=z.object({
  objectIds:z.array(name).min(1).max(128).optional(),
  camera:presentationCameraSchema.nullable().optional(),
  lights:presentationLightsSchema.optional()
}).strict();
const fail=code=>Object.assign(new Error(code),{code});

/** Export current active managed visual entities, not the simulation or editor.
 * A detached scene owns the export camera and lights, so no live state is changed. */
export async function exportSceneGLB(world,input={}){
  const options=sceneGLBOptions.parse(input);
  const stored=world.presentation?.snapshot()??{};
  const {state,root:presentation}=buildPresentationGroup({
    camera:options.camera===undefined?stored.camera:options.camera,
    lights:options.lights===undefined?stored.lights:options.lights
  });
  const ids=options.objectIds??Array.from(world.store.entries(),([id,record])=>record.active===false?null:id).filter(Boolean);
  if(!ids.length||ids.length>128||new Set(ids).size!==ids.length)throw fail('SCENE_EXPORT_SELECTION_INVALID');
  const scene=new THREE.Scene();
  const warnings=new Set();
  if(stored.environment)warnings.add('HDRI environment lighting is not embedded in glTF.');
  let nodes=0,vertices=0,meshes=0,pixels=0;
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
        const image=texture.image;
        const browserImage=typeof document!=='undefined'&&
          [globalThis.HTMLImageElement,globalThis.ImageBitmap,globalThis.HTMLCanvasElement,globalThis.OffscreenCanvas]
            .some(Type=>typeof Type==='function'&&image instanceof Type);
        const rgba=texture.isDataTexture&&texture.format===THREE.RGBAFormat&&texture.type===THREE.UnsignedByteType;
        if((!rgba&&!browserImage)||!Number.isSafeInteger(image?.width)||!Number.isSafeInteger(image?.height)||
          image.width<=0||image.height<=0||image.width*image.height>(browserImage?1048576:65536))throw fail('SCENE_EXPORT_TEXTURE_UNSUPPORTED');
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
  for(const item of [...presentation.children])scene.add(item);
  const {GLTFExporter}=await import('three/addons/exporters/GLTFExporter.js');
  const restore=installHeadlessImageSupport();
  try{
    const bytes=new Uint8Array(await new GLTFExporter().parseAsync(scene,{binary:true,onlyVisible:true}));
    return {bytes,summary:{format:'glb',coordinateSystem:'Y-up',scope:'managed-visual-entities',
      objectIds:ids,meshes,materials:materials.size,textures:textures.size,cameras:state.camera?1:0,lights:state.lights.length,
      warnings:[...warnings,'Static visual export: environment, physics, behavior and editor state are not included.']}};
  }finally{restore?.();}
}
