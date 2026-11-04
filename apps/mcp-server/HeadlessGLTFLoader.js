import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { DataTexture, RepeatWrapping, ClampToEdgeWrapping, MirroredRepeatWrapping, NearestFilter, LinearFilter, NearestMipmapNearestFilter, LinearMipmapNearestFilter, NearestMipmapLinearFilter, LinearMipmapLinearFilter } from 'three';
import sharp from 'sharp';

const filters={9728:NearestFilter,9729:LinearFilter,9984:NearestMipmapNearestFilter,9985:LinearMipmapNearestFilter,9986:NearestMipmapLinearFilter,9987:LinearMipmapLinearFilter};
const wrapping={33071:ClampToEdgeWrapping,33648:MirroredRepeatWrapping,10497:RepeatWrapping};
// Headless GLTFLoader cannot use DOM Image/ImageBitmap. Decode trusted embedded bytes
// to real DataTextures; never drop a missing texture or fetch an external URI.
export function createHeadlessGLTFLoader() {
 const loader=new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).register(parser=>({
  name:'AGENTSCAPE_headless_texture',
  async loadTexture(index) {
   const definition=parser.json.textures[index];
   const source=parser.json.images?.[definition.source];
   if (!Number.isInteger(source?.bufferView) || source.uri) throw new Error('AUTHORING_EXTERNAL_TEXTURE_UNSUPPORTED');
   const bytes=await parser.getDependency('bufferView',source.bufferView);
   const {data,info}=await sharp(Buffer.from(bytes),{limitInputPixels:65536}).ensureAlpha().raw().toBuffer({resolveWithObject:true});
   const texture=new DataTexture(new Uint8Array(data),info.width,info.height);
   const sampler=parser.json.samplers?.[definition.sampler] || {};
   texture.magFilter=filters[sampler.magFilter] || LinearFilter;
   texture.minFilter=filters[sampler.minFilter] || LinearMipmapLinearFilter;
   texture.wrapS=wrapping[sampler.wrapS] || RepeatWrapping;
   texture.wrapT=wrapping[sampler.wrapT] || RepeatWrapping;
   texture.flipY=false;
   texture.name=definition.name || source.name || '';
   texture.needsUpdate=true;
   parser.associations.set(texture,{textures:index});
   return texture;
  }
 }));
 return {
  async loadScene(url) {
   const gltf=await loader.loadAsync(url);
   if(!gltf.scene) throw new Error('ASSET_SCENE_MISSING');
   gltf.scene.animations=[...(gltf.animations || [])];
   return gltf.scene;
  }
 };
}
