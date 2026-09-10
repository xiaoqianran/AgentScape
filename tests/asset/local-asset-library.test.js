import { describe, expect, it, vi } from 'vitest';
import { LocalAssetLibrary } from '../../modules/asset/LocalAssetLibrary.js';
import { LocalAssetLibraryStore } from '../../modules/asset/storage/LocalAssetLibraryStore.js';

const compiledManifest={
  id:'generated_chair',label:'Generated Chair',type:'object',actions:['move'],
  source:{kind:'compiled',key:'compiled/generated_chair.glb'},physics:{body:'fixed',colliders:[]}
};

describe('LocalAssetLibrary',()=>{
  it('requires explicit approval and keeps approval metadata separate from compiled GLB bytes',async()=>{
    const store=new LocalAssetLibraryStore({indexedDBImpl:null});
    const manager={has:vi.fn((id)=>id==='generated_chair'),getManifest:vi.fn(()=>compiledManifest)};
    const compiledStore={has:vi.fn(async(key)=>key==='compiled/generated_chair.glb')};
    const library=new LocalAssetLibrary({assetManager:manager,compiledStore,store,now:()=> '2026-09-09T00:00:00.000Z'});

    expect(library.listSync()).toEqual([]);
    await expect(library.approve('generated_chair',{sourceImageArtifactId:'image_01'})).resolves.toMatchObject({
      assetId:'generated_chair',status:'approved',sourceKey:'compiled/generated_chair.glb',sourceImageArtifactId:'image_01'
    });
    expect(compiledStore.has).toHaveBeenCalledWith('compiled/generated_chair.glb');
    expect(library.listSync()).toHaveLength(1);

    const restored=new LocalAssetLibrary({assetManager:manager,compiledStore,store});
    await restored.hydrate();
    expect(restored.listSync()).toMatchObject([{assetId:'generated_chair',status:'approved'}]);
  });

  it('rejects builtin assets and compiled manifests without durable GLB bytes',async()=>{
    const store=new LocalAssetLibraryStore({indexedDBImpl:null});
    const builtin=new LocalAssetLibrary({
      assetManager:{has:()=>true,getManifest:()=>({id:'chair',source:{kind:'builtin'}})},
      compiledStore:{has:async()=>true},store
    });
    await expect(builtin.approve('chair')).rejects.toMatchObject({code:'ASSET_LIBRARY_COMPILED_REQUIRED'});

    const missing=new LocalAssetLibrary({
      assetManager:{has:()=>true,getManifest:()=>compiledManifest},
      compiledStore:{has:async()=>false},store
    });
    await expect(missing.approve('generated_chair')).rejects.toMatchObject({code:'ASSET_LIBRARY_BYTES_MISSING'});
  });
});
