import { expect,it } from 'vitest';
import sharp from 'sharp';
import { generateProceduralTexture } from '../../modules/asset/production/ProceduralTexture.js';
import { recipeSchema } from '../../modules/asset/model/AssetInputContracts.js';
import { compileRecipeGeometry } from '../../modules/asset/production/AssetRecipe.js';
import { createAssetGLTFIO } from '../../modules/asset/production/compiler/gltfIO.js';
import { createHeadlessGLTFLoader } from '../../apps/mcp-server/HeadlessGLTFLoader.js';
import { installHeadlessAssetIO } from '../../apps/mcp-server/HeadlessAssetIO.js';

const recipe=(textures)=>({schema:'agentscape.asset-recipe',schemaVersion:1,id:'texture/sample',
  parts:textures.map((texture,i)=>({id:'part'+i,geometry:{type:'box',size:[1,1,1]},material:{color:'#ffffff',texture}}))});
const decode=bytes=>sharp(bytes).raw().toBuffer({resolveWithObject:true});
it('generates repeatable distinct patterns, RGBA color and non-flat normal maps',async()=>{
  const hashes=new Set();
  for(const pattern of ['wood','stone','fabric','brushed-metal']){
    const options={pattern,seed:17,resolution:64};
    const a=generateProceduralTexture(options),b=generateProceduralTexture(options);
    expect(a).toEqual(b);
    expect(a.baseColor).not.toEqual(generateProceduralTexture({...options,seed:18}).baseColor);
    const image=await decode(a.baseColor),normal=await decode(a.normal);
    expect(image.info).toMatchObject({width:64,height:64,channels:4});
    expect(normal.info).toMatchObject({width:64,height:64,channels:4});
    const channels=new Set(image.data.filter((_,i)=>i%4===0));
    expect(channels.size).toBeGreaterThan(8);
    expect(new Set(normal.data.filter((_,i)=>i%4===0)).size).toBeGreaterThan(3);
    expect(normal.data.filter((_,i)=>i%4===2).every(x=>x>127)).toBe(true);
    expect(image.data.filter((_,i)=>i%4===3).every(x=>x===255)).toBe(true);
    hashes.add(Buffer.from(a.baseColor).toString('base64'));
  }
  expect(hashes.size).toBe(4);
  const flat=generateProceduralTexture({pattern:'wood',normalStrength:0,contrast:0,resolution:64});
  expect(flat.normal).toBeNull();
  expect(new Set((await decode(flat.baseColor)).data.filter((_,i)=>i%4===0)).size).toBe(1);
});
it('embeds and shares actual glTF textures, and loads their original pixels without a DOM',async()=>{
  installHeadlessAssetIO();
  const texture={pattern:'wood',seed:5,resolution:64};
  const input=recipe([texture,texture,{pattern:'fabric',resolution:64,normalStrength:0}]);
  const {bytes}=await compileRecipeGeometry(input);
  expect((await compileRecipeGeometry(input)).bytes).toEqual(bytes);
  const doc=await createAssetGLTFIO().readBinary(bytes);
  const [a,b,c]=doc.getRoot().listMaterials();
  expect(doc.getRoot().listTextures()).toHaveLength(3);
  expect(a.getBaseColorTexture()).toBe(b.getBaseColorTexture());
  expect(a.getNormalTexture()).toBe(b.getNormalTexture());
  expect(c.getNormalTexture()).toBeNull();
  const scene=await createHeadlessGLTFLoader().loadBytes(bytes);
  let mesh;scene.traverse(n=>{if(n.isMesh&&!mesh)mesh=n;});
  expect(mesh.material.map.image.width).toBe(64);
  expect(mesh.material.normalMap.image.width).toBe(64);
  const expected=generateProceduralTexture(texture);
  expect(Buffer.from(mesh.material.map.image.data)).toEqual((await decode(expected.baseColor)).data);
  expect(Buffer.from(mesh.material.normalMap.image.data)).toEqual((await decode(expected.normal)).data);
});
it('rejects unsupported inputs and bounds unique texture pixel budgets',()=>{
  expect(()=>recipeSchema.parse(recipe([{pattern:'wood',resolution:512}]))).toThrow();
  expect(()=>recipeSchema.parse(recipe([{pattern:'wood',normalStrength:2}]))).toThrow();
  expect(()=>recipeSchema.parse(recipe([{pattern:'wood',darkColor:'bad'}]))).toThrow();
  expect(()=>recipeSchema.parse(recipe([{pattern:'wood',seed:-1}]))).toThrow();
  expect(()=>recipeSchema.parse(recipe(Array.from({length:5},(_,seed)=>({pattern:'wood',resolution:256,seed}))))).toThrow('Procedural texture pixel budget exceeded');
  expect(()=>recipeSchema.parse(recipe(Array.from({length:10},()=>({pattern:'wood',resolution:256}))))).not.toThrow();
  const noGeometry=recipe([{pattern:'wood'}]);delete noGeometry.parts[0].geometry;
  expect(()=>recipeSchema.parse(noGeometry)).toThrow('requires geometry');
});
