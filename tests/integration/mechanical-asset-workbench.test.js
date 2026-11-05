import { it, expect } from 'vitest';
import { createSession } from '../../application/createSession.js';
import { AgentTools } from '../../application/AgentTools.js';
import { createBlankWorld } from '../../modules/world/content/blankWorld.js';
import { createAssetModule } from '../../modules/asset/AssetModule.js';
import { createHeadlessGLTFLoader } from '../../apps/mcp-server/HeadlessGLTFLoader.js';
import { installHeadlessAssetIO } from '../../apps/mcp-server/HeadlessAssetIO.js';
import { industrialCabinetDraft, mechanicalDraftSchema } from '../../modules/asset/model/MechanicalAssetDraft.js';
import { assetAdmission } from '../../modules/asset/model/admission.js';

async function finished(scene,job) {
  for(let i=0;i<2200 && scene.getJob(job.id).status==='running';i++) {
    scene.step();
    if(i%12===0)await new Promise(resolve=>setTimeout(resolve,0));
    else await Promise.resolve();
  }
  expect(scene.getJob(job.id).status).not.toBe('running');
  return scene.waitJob(job.id);
}

it('mechanical authoring rejects invalid parts and joint limits',()=>{
  const draft=industrialCabinetDraft();
  expect(mechanicalDraftSchema.safeParse(draft).success).toBe(true);
  draft.motions[0].limits=[0,1];
  expect(mechanicalDraftSchema.safeParse(draft).success).toBe(false);
  draft.motions[0].limits=[-1.35,0];
  draft.components[0].id=draft.components[1].id;
  expect(mechanicalDraftSchema.safeParse(draft).success).toBe(false);
});

it('creates a multi-joint machine through GLB compiler and isolated physics verification',async()=>{
  installHeadlessAssetIO();
  const session=createSession(null,{assetModule:createAssetModule({gltfLoader:createHeadlessGLTFLoader()}),environmentFactory:()=>createBlankWorld({id:'mechanical-asset-test'})});
  await session.world.init();
  const {world,scene}=session;
  try {
    const imported=await world.assetModule.importMechanicalDraft(industrialCabinetDraft());
    const assetId=imported.manifest.id;
    expect(assetId).toMatch(/^asset_[a-f0-9]{64}$/);
    expect(imported.manifest.parts).toHaveProperty('left_door');
    expect(imported.manifest.parts).toHaveProperty('right_door');
    expect(imported.manifest.parts).toHaveProperty('upper_drawer');
    expect(imported.manifest.parts).toHaveProperty('lower_drawer');
    expect(imported.admission.layers.runtime.status).toBe('ready');
    const repeated=await world.assetModule.importMechanicalDraft(industrialCabinetDraft());
    expect(repeated.manifest.id).toBe(assetId);
    await scene.addModel({id:'machine_01',asset:'asset://sha256/'+assetId.slice('asset_'.length),position:[0,0,-2.5]});
    expect(world.physics.entries.get('machine_01').parts.size).toBe(4);
    const declarative=await scene.addModel({id:'machine_02',asset:industrialCabinetDraft(),position:[4,0,-2.5]});
    expect(declarative.admission.layers.runtime.status).toBe('ready');
    expect(world.physics.entries.get('machine_02').parts.size).toBe(4);
    const agentTools=new AgentTools(world,{profile:'builder',actor:'operator',source:'test-agent'});
    await agentTools.call('addSceneModel',{model:{id:'machine_03',asset:industrialCabinetDraft(),position:[8,0,-2.5]}});
    expect(world.physics.entries.get('machine_03').parts.size).toBe(4);
    const agent=await scene.addModel({id:'operator',asset:'builtin://agent',position:[-2,0,1]});
    expect(agent.id).toBe('operator');
    const action=scene.inspect('machine_01',{actor:'operator'});
    expect(action.actions.some(x=>x.action==='open'&&x.partName==='left_door')).toBe(true);
    const done=await finished(scene,scene.interact({actor:'operator',target:'machine_01',action:'open',partName:'left_door'}));
    expect(done.status,JSON.stringify(done)).toBe('succeeded');
    expect(done.result.verification.status).toBe('verified');
  }finally {scene.close();world.dispose();}
},90000);
