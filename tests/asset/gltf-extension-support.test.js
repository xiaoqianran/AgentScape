import { Document, WebIO } from '@gltf-transform/core';
import { EXTTextureWebP } from '@gltf-transform/extensions';
import sharp from 'sharp';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { AssetCompiler } from '../../asset/compiler/AssetCompiler.js';
import { createAssetGLTFIO } from '../../asset/compiler/gltfIO.js';

async function makeRequiredWebPGlb() {
  const document = new Document();
  const buffer = document.createBuffer('buffer');
  const scene = document.createScene('Scene');
  document.getRoot().setDefaultScene(scene);

  const image = new Uint8Array(await sharp({
    create:{width:2,height:2,channels:4,background:{r:180,g:120,b:80,alpha:1}}
  }).webp().toBuffer());
  document.createExtension(EXTTextureWebP).setRequired(true);
  const texture = document.createTexture('webp-texture').setImage(image).setMimeType('image/webp');
  const material = document.createMaterial('material').setBaseColorTexture(texture);

  const geometry = new THREE.BoxGeometry(1,1,1);
  const accessor = (name, itemSize, array) => document.createAccessor(name)
    .setType(itemSize===2?'VEC2':'VEC3')
    .setArray(new Float32Array(array))
    .setBuffer(buffer);
  const primitive = document.createPrimitive()
    .setAttribute('POSITION', accessor('position',3,geometry.getAttribute('position').array))
    .setAttribute('NORMAL', accessor('normal',3,geometry.getAttribute('normal').array))
    .setAttribute('TEXCOORD_0', accessor('uv',2,geometry.getAttribute('uv').array))
    .setIndices(document.createAccessor('indices').setType('SCALAR').setArray(new Uint16Array(geometry.index.array)).setBuffer(buffer))
    .setMaterial(material);
  scene.addChild(document.createNode('Box').setMesh(document.createMesh('Box').addPrimitive(primitive)));
  geometry.dispose();

  return new Uint8Array(await new WebIO().registerExtensions([EXTTextureWebP]).writeBinary(document));
}

describe('AssetCompiler glTF extension support',()=>{
  it('accepts and preserves required EXT_texture_webp assets',async()=>{
    const input=await makeRequiredWebPGlb();
    let stored=null;
    const compiler=new AssetCompiler({store:{put:async(_key,bytes)=>{stored=new Uint8Array(bytes);}}});
    const result=await compiler.compile({bytes:input,sourceName:'webp.glb',assetId:'webp_asset'});
    expect(result.quality.status).not.toBe('rejected');
    expect(stored).toBeInstanceOf(Uint8Array);
    const roundTrip=await createAssetGLTFIO().readBinary(stored);
    expect(roundTrip.getRoot().listExtensionsUsed().map((extension)=>extension.extensionName)).toContain('EXT_texture_webp');
  });
});
