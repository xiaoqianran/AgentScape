// Agent-driven live world building from pure Three.js code.
//
// Runs a real ToolCallingAgent against a real WorldRuntime (Rapier + Recast) in
// plain Node. The "LLM" is a scripted gateway: each round it plays the model's
// decision, so the full contract loop (gates, barrier, replan, admission,
// rollback, promotion) executes exactly as it would with a live model.
//
// Usage: node dev/experiments/agent/001-authoring-code-agent-loop.mjs
import * as THREE from 'three';
import { createWorldAuthoringContext } from '../../../application/createWorldAuthoringContext.js';
import { AuthoringPromotionController } from '../../../application/world-authoring/AuthoringPromotionController.js';
import { createAuthoringAssetProducer } from '../../../application/world-authoring/AuthoringAssetProducer.js';
import { createAssetModule } from '../../../modules/asset/AssetModule.js';
import { createArtifactModule } from '../../../modules/artifact/ArtifactModule.js';
import { WorldRuntime } from '../../../modules/world/runtime/WorldRuntime.js';
import { WorldQueries } from '../../../modules/world/runtime/WorldQueries.js';
import { CommandHistory } from '../../../modules/world/runtime/CommandHistory.js';
import { RenderingSystem } from '../../../modules/world/runtime/systems/RenderingSystem.js';
import { PhysicsSystem } from '../../../modules/world/runtime/systems/PhysicsSystem.js';
import { RapierPhysicsBackend } from '../../../modules/physics/RapierPhysicsBackend.js';
import { NavigationSystem } from '../../../modules/world/runtime/systems/NavigationSystem.js';
import { RecastNavigationBackend } from '../../../modules/navigation/RecastNavigationBackend.js';
import { SkillRegistry } from '../../../application/skills/SkillRegistry.js';
import { AgentTools } from '../../../application/AgentTools.js';
import { ToolCallingAgent } from '../../../modules/agent/ToolCallingAgent.js';
import { registerSceneSkills } from '../../../application/skills/packs/sceneSkills.js';
import { registerAuthoringSkills } from '../../../application/skills/packs/authoringSkills.js';
import { registerCodeSkills } from '../../../application/skills/packs/codeSkills.js';

const say = (line = '') => console.log(line);
const banner = (title) => say(`\n=== ${title} ${'='.repeat(Math.max(0, 64 - title.length))}`);

class ScriptedLLMGateway {
  constructor(responses) { this.responses = [...responses]; this.requests = []; }
  isConfigured() { return true; }
  async complete(request) {
    this.requests.push(request);
    return this.responses.shift() || { message:'任务完成。', toolCalls:[] };
  }
}

async function main() {
  banner('booting WorldRuntime (Rapier + Recast)');
  const physics = new PhysicsSystem({ backend:new RapierPhysicsBackend() });
  await physics.init();
  const assets = createAssetModule({ manifestStore:null, libraryStore:null });
  const artifacts = createArtifactModule({ persistentStore:null });
  assets.configureProduction({ artifacts });
  const world = new WorldRuntime({ assetModule:assets, environmentFactory:()=>null, physicsFactory:()=>physics });
  const ground = new THREE.Mesh(new THREE.BoxGeometry(30, .1, 30), new THREE.MeshStandardMaterial());
  ground.position.y = -.05;
  world.environment = { id:'authoring-code-demo', root:ground, colliders:[] };
  world.rendering = new RenderingSystem({ container:{}, scene:world.scene });
  world.navigation = new NavigationSystem({ store:world.store, physics, environmentRoots:[ground], backend:new RecastNavigationBackend() });
  world.locomotion = { cancel:()=>{}, cancelAll:()=>{} };
  world.interactions = { cancelPending:()=>{}, beforeRemove:()=>{}, rebuildHeldOwnership:()=>{} };
  world.sceneGraph = { batch:async fn=>fn(), changed:()=>{}, update:()=>{}, list:()=>[], removeObject:()=>{} };
  world.history = new CommandHistory({ apply:scene=>world.restore(scene), events:world.events });
  const authoring = createWorldAuthoringContext(world);
  const promotion = new AuthoringPromotionController({
    authoring, world,
    produceAsset:createAuthoringAssetProducer({ assets, artifacts })
  });
  world.queries ||= new WorldQueries(world);
  const skills = new SkillRegistry({ policy:world.policy, trace:world.trace, runtime:world });
  const add = (name, options, handler) => skills.register({ name, ...options, handler });
  registerSceneSkills(add, world);
  registerAuthoringSkills(add, promotion);
  registerCodeSkills(add, authoring);
  world.skills = skills;
  const tools = new AgentTools(world, { actor:'agent' });
  say(`skills exposed to the LLM: ${tools.definitions().map((tool)=>tool.name).join(', ')}`);

  // ---- The "model" decisions (this script plays the LLM) -------------------
  const BROKEN_CODE = `
const floor = new THREE.Mesh(
  new THREE.BoxGeometry(4, 0.2, 4),
  new THREE.StandarMaterial({ color: '#b8926a' })   // typo: StandarMaterial
);
floor.position.y = -0.1;
scene.add(floor);
`;
  const GOOD_CODE = `
const room = new THREE.Group();
const floor = new THREE.Mesh(
  new THREE.BoxGeometry(4, 0.2, 4),
  new THREE.MeshStandardMaterial({ color: '#b8926a' })
);
floor.position.y = -0.1;
room.add(floor);
for (const [x, z, w, d] of [[0, -2, 4.2, 0.2], [0, 2, 4.2, 0.2], [-2, 0, 0.2, 4], [2, 0, 0.2, 4]]) {
  const wall = new THREE.Mesh(
    new THREE.BoxGeometry(w, 2.4, d),
    new THREE.MeshStandardMaterial({ color: '#e8e2d4' })
  );
  wall.position.set(x, 1.2, z);
  room.add(wall);
}
const cup = new THREE.Group();
cup.name = 'desk-cup';
cup.userData.authoringId = 'desk-cup';
cup.position.set(0.6, 1, 0);
modelRef(cup, { assetRef: { assetId: 'cup' } });
room.add(cup);
scene.add(room);
`;
  const gateway = new ScriptedLLMGateway([
    { message:'我先用纯 Three.js 搭建书房。', toolCalls:[
      { id:'call_1', name:'runAuthoringCode', args:{ code:BROKEN_CODE, label:'study room' } }
    ] },
    { message:'代码有拼写错误且草稿已恢复，我修正后重新提交。', toolCalls:[
      { id:'call_2', name:'runAuthoringCode', args:{ code:GOOD_CODE, label:'study room' } }
    ] },
    { message:'草稿已构建完成，把 desk-cup 晋升为正式世界实体。', toolCalls:[
      { id:'call_3', name:'promoteAuthoringNode', args:{ nodeId:'desk-cup', usage:'movable' } }
    ] },
    { message:'书房构建完成：墙体与地板草稿在创作层，cup 已成为通过物理与导航验证的正式实体。', toolCalls:[] }
  ]);

  banner('agent run: 从零搭建书房（纯 Three.js → 真实世界）');
  const agent = new ToolCallingAgent({
    tools, gateway, maxSteps:8,
    log:(message, kind) => say(`  [${kind}] ${message.length > 160 ? message.slice(0, 160) + '…' : message}`)
  });
  const result = await agent.run('从零搭建一个书房：地板、四面墙，并把一个杯子作为可拿取的真实物体放进房间。');

  banner('final world state');
  for (const [id, record] of world.store.list()) {
    const position = world.physics.getPosition(id).map((value)=>Number(value.toFixed(3)));
    say(`  runtime entity ${id} · asset=${record.assetId} · physics position=${JSON.stringify(position)}`);
    say(`  authoring linkage: ${JSON.stringify(world.snapshot().objects.find((object)=>object.id === id)?.state.authoringPromotion)}`);
  }
  const draft = authoring.capture();
  say(`  draft nodes: ${Object.keys(draft.nodesById).join(', ')}`);
  say(`  draft revisions: ${authoring.history().map((entry)=>`${entry.id}(${entry.source})`).join(' → ')}`);
  say(`  taskStatus=${result.taskStatus} · steps=${result.steps} · unresolved=${result.unresolvedMutations.length}`);
  say(`  execution: ${result.execution.map((entry)=>`${entry.tool}→${entry.outcome.state}`).join(' · ')}`);
  say(`\n${result.message}`);

  await promotion.dispose();
  authoring.dispose();
  await world.navigation.dispose();
  await physics.dispose();
  if (result.taskStatus !== 'completed' || world.store.list().length !== 1) {
    say('\nDEMO FAILED');
    process.exitCode = 1;
  } else {
    say('DEMO OK');
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
