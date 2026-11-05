import {describe,it,expect} from 'vitest';
import {createSession} from '../../application/createSession.js';
import {createAssetModule} from '../../modules/asset/AssetModule.js';
import {industrialCabinetDraft,mechanicalDraftToAssetRecipe,mechanicalDraftToManifest,mechanicalDraftSchema} from '../../modules/asset/model/MechanicalAssetDraft.js';
import {assetDigest,canonicalAssetJson} from '../../modules/asset/model/AssetInputContracts.js';
import {createHeadlessGLTFLoader} from '../../apps/mcp-server/HeadlessGLTFLoader.js';
import {installHeadlessAssetIO} from '../../apps/mcp-server/HeadlessAssetIO.js';
import {createBlankWorld} from '../../modules/world/content/blankWorld.js';

const setup=()=>{installHeadlessAssetIO();return createAssetModule({gltfLoader:createHeadlessGLTFLoader()});};
const assetId=async draft=>'asset_'+await assetDigest(new TextEncoder().encode(canonicalAssetJson({draft:mechanicalDraftSchema.parse(draft),compiler:'mechanical-draft-v1'})));

describe('mechanical asset reliability',()=>{
  it('does not publish compiled bytes or a manifest after articulation verification failure',async()=>{
    const assets=setup(),draft=industrialCabinetDraft(),id=await assetId(draft);
    assets.configureVerification({articulationVerifier:{verify:async()=>({ok:false})}});
    await expect(assets.importMechanicalDraft(draft)).rejects.toMatchObject({code:'ASSET_PHYSICS_VERIFICATION_FAILED'});
    expect(await assets.compiledStore.has(id)).toBe(false);
    expect(assets.hasAsset(id)).toBe(false);
  },30000);

  it('rolls back new compiled bytes and registry when manifest persistence fails',async()=>{
    const draft=industrialCabinetDraft(),id=await assetId(draft);
    const manifestStore={
      put:async()=>{throw new Error('PERSISTENCE_FAILURE');},
      delete:async()=>true
    };
    const assets=createAssetModule({manifestStore,gltfLoader:createHeadlessGLTFLoader()});
    installHeadlessAssetIO();
    assets.configureVerification({articulationVerifier:{verify:async()=>({ok:true,parts:[],tested:4,physicsRegistered:true})}});
    await expect(assets.importMechanicalDraft(draft)).rejects.toThrow('PERSISTENCE_FAILURE');
    expect(await assets.compiledStore.has(id)).toBe(false);
    expect(assets.hasAsset(id)).toBe(false);
  },30000);
  it('validates sphere/cylinder geometry and collider bounds using identical dimensions',()=>{
    const draft=industrialCabinetDraft();
    draft.components.push({id:'Sphere',shape:'sphere',parent:null,position:[3,1,0],size:[2,2,2],color:'#123456',collision:true});
    draft.components.push({id:'Cylinder',shape:'cylinder',parent:null,position:[5,1,0],size:[2,3,2],color:'#123456',collision:true});
    const recipe=mechanicalDraftToAssetRecipe(draft);
    const colliders=mechanicalDraftToManifest(draft).physics.colliders;
    expect(recipe.parts.find(p=>p.id==='Sphere').geometry.radius).toBe(1);
    expect(recipe.parts.find(p=>p.id==='Cylinder').geometry).toMatchObject({radius:1,height:3});
    expect(colliders.slice(-2).map(c=>c.halfExtents)).toEqual([[1,1,1],[1,1.5,1]]);
    draft.components.at(-2).size=[2,8,2];
    expect(mechanicalDraftSchema.safeParse(draft).success).toBe(false);
    draft.components.at(-2).size=[2,2,2];
    draft.components.at(-1).size=[2,3,.5];
    expect(mechanicalDraftSchema.safeParse(draft).success).toBe(false);
  });

  it('rejects duplicate entity ids before compiling or registering new assets',async()=>{
    const assets=setup();
    const session=createSession(null,{assetModule:assets,environmentFactory:()=>createBlankWorld({id:'preflight-world'})});
    await session.world.init();
    try{
      await session.scene.addModel({id:'existing',asset:'builtin://cup',position:[0,0,0]});
      const draft=industrialCabinetDraft(),id=await assetId(draft);
      await expect(session.scene.addModel({id:'existing',asset:draft,position:[3,0,0]})).rejects.toMatchObject({code:'DUPLICATE_ID'});
      expect(assets.hasAsset(id)).toBe(false);
      expect(await assets.compiledStore.has(id)).toBe(false);
      expect(session.world.store.list()).toHaveLength(1);
    }finally{session.scene.close();session.world.dispose();}
  });
});
