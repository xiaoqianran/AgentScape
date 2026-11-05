// Headless rendering only. All world behavior uses the production WorldRuntime.init() boundary.
import { readFile } from 'node:fs/promises';
import { createAssetModule } from '../../modules/asset/AssetModule.js';
import { assetManifests } from '../../modules/asset/registry/manifests/index.js';
import { WorldRuntime } from '../../modules/world/runtime/WorldRuntime.js';
import { WorldBuilder } from '../../modules/world/build/WorldBuilder.js';
import { SkillRegistry } from '../../application/skills/SkillRegistry.js';
import { registerCoreSkills } from '../../application/skills/registerCoreSkills.js';
import { AgentTools } from '../../application/AgentTools.js';
import { createMonumentHall } from '../../modules/world/content/monumentHall.js';
import { createWoodlandWorkshop } from '../../modules/world/content/woodlandWorkshop.js';
import { createMagicCabin } from '../../modules/world/content/magicCabin.js';
import { cabinCanvasHost } from '../../tests/helpers/cabinCanvasHost.js';

globalThis.ProgressEvent ||= class ProgressEvent { constructor(type,init={}) { this.type=type; Object.assign(this,init); } };
const factories = {
  'monument-hall':(context)=>createMonumentHall({...context,loadAssets:false}),
  'woodland-workshop':(context)=>createWoodlandWorkshop({...context,loadAssets:false}),
  'magic-cabin':()=>createMagicCabin(cabinCanvasHost())
};
const yieldFrame = ()=>new Promise((resolve)=>setTimeout(resolve,0));

export async function createTaskRuntime(worldId) {
  if (!factories[worldId]) throw new Error(`Unsupported task harness world: ${worldId}`);
  const manifests = structuredClone(assetManifests);
  const bytes = await readFile(new URL('../../public/assets/cabinet.glb',import.meta.url));
  manifests.cabinet.source = {kind:'glb',url:`data:model/gltf-binary;base64,${bytes.toString('base64')}`};
  const runtime = new WorldRuntime({
    environmentFactory:factories[worldId],
    assetModule:createAssetModule({manifests,manifestStore:null,libraryStore:null})
  });
  try {
    await runtime.init();
    // Only the view/camera port is replaced: no runtime mutation or post-condition is mocked.
    runtime.rendering = {viewPose:()=>({position:[0,0,0],rotation:[0,0,0,1]}),cameraState:()=>null,applyCameraState:()=>true,applyEnvironment(){},update(){},dispose(){}};
    const worldBuilder = new WorldBuilder(runtime);
    runtime.skills = registerCoreSkills(new SkillRegistry({policy:runtime.policy,trace:runtime.trace,runtime}),runtime,{worldBuilder});
    const tools = new AgentTools(runtime,{profile:'builder',actor:'agent_01'});
    return {runtime,worldBuilder,tools,dispose:()=>runtime.dispose()};
  } catch (error) { runtime.dispose(); throw error; }
}

export async function settleWorld(runtime, frames = 30) {
  for (let frame=0;frame<frames;frame++) {
    runtime.stepSimulation(1/60);
    runtime.sceneGraph.update();
    if (frame%12 === 0) await yieldFrame(); else await Promise.resolve();
  }
}

export async function driveWorld(promise,runtime,{maxFrames=12000}={}) {
  let done=false,result,error;
  promise.then((value)=>{done=true;result=value;},(cause)=>{done=true;error=cause;});
  for (let frame=0;frame<maxFrames && !done;frame++) {
    runtime.stepSimulation(1/60);
    runtime.sceneGraph.update();
    if (frame%12 === 0) await yieldFrame(); else await Promise.resolve();
  }
  if (error) throw error;
  if (!done) {
    runtime.interactions.cancelPending('ACCEPTANCE_FRAME_BUDGET');
    runtime.locomotion.cancelAll('ACCEPTANCE_FRAME_BUDGET');
    const failure=new Error('World action exceeded the deterministic frame budget');
    failure.code='ACCEPTANCE_FRAME_BUDGET';
    throw failure;
  }
  return result;
}
