import { describe, expect, it } from 'vitest';
import { recipeSchema, assertEmbeddedGLB } from '../../modules/asset/model/AssetInputContracts.js';
import { compileRecipeGeometry } from '../../modules/asset/production/AssetRecipe.js';
import { createAssetModule } from '../../modules/asset/AssetModule.js';
import { createHeadlessGLTFLoader } from '../../apps/mcp-server/HeadlessGLTFLoader.js';
import { installHeadlessAssetIO } from '../../apps/mcp-server/HeadlessAssetIO.js';

const treeRecipe = () => ({
  schema:'agentscape.asset-recipe',schemaVersion:1,id:'example/organic_tree',
  parts:[
    {id:'trunk',geometry:{type:'tapered-cylinder',radiusTop:0.19,radiusBottom:0.4,height:2.4},position:[0,1.2,0],material:{color:'#754126'}},
    {id:'branch',geometry:{type:'segment',from:[0,0,0],to:[0.8,1.1,-0.3],radiusStart:0.16,radiusEnd:0.04},position:[0,1.4,0]},
    {id:'foliage',geometry:{type:'ellipsoid',radii:[1.15,0.8,0.95]},position:[0,2.8,0],material:{color:'#397c38'}},
    {id:'fruit',geometry:{type:'sphere',radius:0.12},position:[0.55,2.25,0.3],material:{color:'#d82d37'}}
  ]
});

describe('bounded organic procedural Asset Recipe geometry', () => {
  it('validates and compiles tapered trunks, angled branches and ellipsoid crowns to self-contained GLB', async () => {
    const input=treeRecipe();
    expect(recipeSchema.safeParse(input).success).toBe(true);
    const {recipe,bytes}=await compileRecipeGeometry(input);
    expect(recipe.parts).toHaveLength(4);
    expect(bytes.byteLength).toBeGreaterThan(200);
    const gltf=assertEmbeddedGLB(bytes);
    expect(gltf.nodes.map(x=>x.name)).toEqual(expect.arrayContaining(['trunk','branch','foliage','fruit']));
    installHeadlessAssetIO();
    const module=createAssetModule({manifests:{},manifestStore:null,libraryStore:null,gltfLoader:createHeadlessGLTFLoader()});
    const imported=await module.importRecipe(input);
    expect(imported.asset).toMatch(/^asset:\/\/sha256\//);
    expect(imported.manifest.capabilityLevel).toBe('visual');
  });
  it('rejects a zero-length segment before geometry compilation',()=>{
    const invalid=treeRecipe();
    invalid.parts[1].geometry.to=[0,0,0];
    expect(recipeSchema.safeParse(invalid).success).toBe(false);
  });
});
