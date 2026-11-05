import { it, expect } from 'vitest';
import { openScene } from '../../application/scene/SceneFacade.js';
import { openScenePackage } from '../../application/scene/ScenePackage.js';
import { createCodeExecutor } from '../../apps/mcp-server/CodeExecutor.js';
import { installHeadlessAssetIO } from '../../apps/mcp-server/HeadlessAssetIO.js';
import { createHeadlessGLTFLoader } from '../../apps/mcp-server/HeadlessGLTFLoader.js';
import { createAssetModule } from '../../modules/asset/AssetModule.js';
import { box } from '../../apps/mcp-server/examples/procedural-assets.js';
import { house } from '../../apps/mcp-server/examples/code-house.js';

it('registers visual and physical code assets, rejects broken code, saves and restores the real world', async () => {
  installHeadlessAssetIO();
  const loader=createHeadlessGLTFLoader();
  const assets=()=>createAssetModule({volatile:true,manifestStore:null,libraryStore:null,gltfLoader:loader});
  const assetModule=assets();
  const scene=await openScene({project:{schema:'agentscape.scene-project',schemaVersion:1,name:'Code world',environment:{type:'builtin',id:'monument-hall'},objects:[]},assetModule,codeExecutor:createCodeExecutor(),codeGLTFLoader:loader});
  let restored;
  try {
    await scene.addModel({id:'visual',asset:{kind:'three-code',source:box.source}});
    await scene.addModel({id:'box',asset:{kind:'three-code',...box},position:[4,0,4]});
    const built=await scene.addModel({id:'house',asset:{kind:'three-code',...house},position:[0,0,-5]});
    expect(built.execution.status).toBe('succeeded');
    expect(built.buildValidation.runtime.physicsRegistered).toBe(true);
    expect(built.buildValidation.runtime.ok).toBe(true);
    await expect(scene.addModel({id:'bad',asset:{kind:'three-code',source:'invalid code'}})).rejects.toThrow();
    const assetCount=assetModule.registry.size;
    await expect(scene.addModel({id:'rejected',level:'interactive',asset:{kind:'three-code',source:box.source.replace('0xff8844','0x4488ff')}})).rejects.toThrow('CAPABILITY_UNAVAILABLE');
    expect(assetModule.registry.size).toBe(assetCount);
    expect(scene.observe().objects).toHaveLength(3);
    const saved=(await scene.save()).value;
    expect(saved.assets).toHaveLength(3);
    const transported=saved.assets.find(a=>a.definition.type==='building');
    const transportScene=await openScene({project:{schema:'agentscape.scene-project',schemaVersion:1,name:'Transport',environment:{type:'builtin',id:'monument-hall'},objects:[]},assetModule:assets(),codeGLTFLoader:loader});
    try {
      const asset={kind:'compiled-code',id:transported.id,bytes:new Uint8Array(Buffer.from(transported.bytes,'base64')),definition:transported.definition};
      expect((await transportScene.addModel({id:'transported',asset})).status).toBe('succeeded');
      expect((await transportScene.addModel({id:'second',asset,position:[7,0,0]})).status).toBe('succeeded');
    } finally {transportScene.close();}
    scene.close();
    restored=await openScenePackage(saved,{assetModule:assets()});
    expect(restored.observe().objects).toHaveLength(3);
    expect(restored.observe().objects.find(o=>o.id==='house').physicsRegistered).toBe(true);
  } finally { restored?.close(); scene.close(); }
},60000);
