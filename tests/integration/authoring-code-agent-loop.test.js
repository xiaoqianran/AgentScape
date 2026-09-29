import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createWorldAuthoringContext } from '../../application/createWorldAuthoringContext.js';
import { AuthoringPromotionController } from '../../application/world-authoring/AuthoringPromotionController.js';
import { createAuthoringAssetProducer } from '../../application/world-authoring/AuthoringAssetProducer.js';
import { createAssetModule } from '../../modules/asset/AssetModule.js';
import { createArtifactModule } from '../../modules/artifact/ArtifactModule.js';
import { WorldRuntime } from '../../modules/world/runtime/WorldRuntime.js';
import { WorldQueries } from '../../modules/world/runtime/WorldQueries.js';
import { CommandHistory } from '../../modules/world/runtime/CommandHistory.js';
import { RenderingSystem } from '../../modules/world/runtime/systems/RenderingSystem.js';
import { createRapierPhysicsSystem } from '../helpers/createRapierPhysicsSystem.js';
import { createRecastNavigationSystem } from '../helpers/createRecastNavigationSystem.js';
import { SkillRegistry } from '../../application/skills/SkillRegistry.js';
import { AgentTools } from '../../application/AgentTools.js';
import { ToolCallingAgent } from '../../modules/agent/ToolCallingAgent.js';
import { registerSceneSkills } from '../../application/skills/packs/sceneSkills.js';
import { registerAuthoringSkills } from '../../application/skills/packs/authoringSkills.js';
import { registerCodeSkills } from '../../application/skills/packs/codeSkills.js';

const cleanup = [];
afterEach(() => { for (const dispose of cleanup.splice(0).reverse()) dispose(); vi.unstubAllGlobals(); });

async function fixture() {
  const physics = createRapierPhysicsSystem();
  await physics.init();
  cleanup.push(() => physics.dispose());
  const assets = createAssetModule({ manifestStore:null, libraryStore:null });
  const artifacts = createArtifactModule({ persistentStore:null });
  assets.configureProduction({ artifacts });
  const world = new WorldRuntime({ assetModule:assets, environmentFactory:()=>null, physicsFactory:()=>physics });
  const ground = new THREE.Mesh(new THREE.BoxGeometry(30, .1, 30), new THREE.MeshStandardMaterial());
  ground.position.y = -.05;
  world.environment = { id:'authoring-code-loop', root:ground, colliders:[] };
  world.rendering = new RenderingSystem({ container:{}, scene:world.scene });
  world.navigation = createRecastNavigationSystem({ store:world.store, physics, environmentRoots:[ground] });
  cleanup.push(() => world.navigation.dispose());
  world.locomotion = { cancel:vi.fn(), cancelAll:vi.fn() };
  world.interactions = { cancelPending:vi.fn(), beforeRemove:vi.fn(), rebuildHeldOwnership:vi.fn() };
  world.sceneGraph = { batch:async fn=>fn(), changed:vi.fn(), update:vi.fn(), list:()=>[], removeObject:vi.fn() };
  world.history = new CommandHistory({ apply:scene=>world.restore(scene), events:world.events });
  const authoring = createWorldAuthoringContext(world);
  cleanup.push(() => authoring.dispose());
  const producer = createAuthoringAssetProducer({ assets, artifacts });
  const promotion = new AuthoringPromotionController({ authoring, world, produceAsset:producer });
  cleanup.push(() => promotion.dispose());
  world.queries ||= new WorldQueries(world);
  const skills = new SkillRegistry({ policy:world.policy, trace:world.trace, runtime:world });
  const add = (name, options, handler) => skills.register({ name, ...options, handler });
  registerSceneSkills(add, world);
  registerAuthoringSkills(add, promotion);
  registerCodeSkills(add, authoring);
  world.skills = skills;
  const tools = new AgentTools(world, { actor:'agent' });
  return { world, authoring, promotion, tools };
}

// A scripted LLM: each complete() pops the next assistant decision.
// This plays the role of the model driving the real ToolCallingAgent loop.
class ScriptedLLMGateway {
  constructor(responses, { observe = () => {} } = {}) {
    this.responses = [...responses];
    this.observe = observe;
    this.requests = [];
  }
  isConfigured() { return true; }
  async complete(request) {
    this.requests.push(request);
    this.observe(request, this.requests.length);
    return this.responses.shift() || { message:'任务完成。', toolCalls:[] };
  }
}

const BROKEN_CODE = `
const floor = new THREE.Mesh(
  new THREE.BoxGeometry(4, 0.2, 4),
  new THREE.StandarMaterial({ color: '#b8926a' })
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

describe('Agent writes Three.js code into a live world (LLM in the loop)', () => {
  it('recovers from a failed submission, rebuilds the draft, promotes a real entity and completes', async () => {
    const { world, authoring, tools } = await fixture();
    const baseline = authoring.export();
    const snapshots = [];
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
    ], { observe:() => { snapshots.push(authoring.export()); } });

    const logs = [];
    const agent = new ToolCallingAgent({
      tools, gateway, maxSteps:8,
      log:(message, kind) => logs.push(`${kind}: ${message}`)
    });
    const result = await agent.run('从零搭建一个书房：地板、四面墙，并把一个杯子作为可拿取的真实物体放进房间。');

    // Terminal state: the promoted entity is an accepted mutation and no mutation stays unresolved.
    expect(result.taskStatus).toBe('completed');
    expect(result.unresolvedMutations).toEqual([]);
    expect(result.steps).toBe(4);

    // Round 1 failed, the draft was restored to the exact baseline before the retry round.
    expect(snapshots[1]).toEqual(baseline);

    // Execution log: failed code -> fixed code -> promotion, all through the real gates.
    expect(result.execution.map((entry)=>[entry.tool, entry.outcome.state, entry.executed])).toEqual([
      ['runAuthoringCode', 'failed', true],
      ['runAuthoringCode', 'accepted', true],
      ['promoteAuthoringNode', 'accepted', true]
    ]);
    expect(result.execution[0].outcome.reason).toBe('AUTHORING_CODE_EXECUTION_ERROR');
    expect(result.execution[1].outcome.status).toBe('authoring-code-applied');

    // The world now owns a real, physics-registered cup entity at the authored pose.
    const entities = world.store.list();
    expect(entities).toHaveLength(1);
    const [entityId, record] = entities[0];
    expect(record.assetId).toBe('cup');
    expect(world.snapshot().objects[0].state.authoringPromotion.nodeId).toBe('desk-cup');
    const position = world.physics.getPosition(entityId);
    expect(position[0]).toBeCloseTo(0.6, 5);
    expect(position[1]).toBe(1);
    expect(position[2]).toBe(0);

    // The authoring draft keeps the visual room; the promoted node stays suppressed in the draft.
    const draft = authoring.capture();
    expect(Object.keys(draft.nodesById)).toContain('desk-cup');
    expect(authoring.get('desk-cup').visible).toBe(false);
    const agentCodeRevisions = authoring.history().filter((entry)=>entry.source === 'agent-code');
    expect(agentCodeRevisions).toHaveLength(1);
    expect(agentCodeRevisions[0].label).toBe('study room');

    // The gateway only ever saw the real tool contract surface.
    expect(gateway.requests[0].tools.map((tool)=>tool.name)).toContain('runAuthoringCode');
    expect(logs.some((line)=>line.includes('sequence: runAuthoringCode → failed'))).toBe(true);
  });

  it('keeps a forbidden-API submission out of the draft and lets the agent correct course', async () => {
    const { world, authoring, tools } = await fixture();
    const gateway = new ScriptedLLMGateway([
      { message:'尝试加载外部模型。', toolCalls:[
        { id:'call_1', name:'runAuthoringCode', args:{ code:'fetch("/models/leak.glb")', label:'leak' } }
      ] },
      { message:'沙箱禁止外部网络访问，改用本地几何构建。', toolCalls:[
        { id:'call_2', name:'runAuthoringCode', args:{ code:'scene.add(new THREE.Mesh(new THREE.BoxGeometry(1,1,1), new THREE.MeshStandardMaterial({})));', label:'box' } }
      ] },
      { message:'盒子草稿已创建。', toolCalls:[] }
    ]);
    const agent = new ToolCallingAgent({ tools, gateway, maxSteps:6, log:() => {} });
    const result = await agent.run('放一个盒子。');
    expect(result.taskStatus).toBe('completed');
    expect(result.execution[0].outcome).toMatchObject({ state:'failed', reason:'AUTHORING_CODE_FORBIDDEN_API' });
    expect(result.execution[1].outcome.state).toBe('accepted');
    expect(world.store.list()).toHaveLength(0);
    expect(authoring.scene.children.length).toBe(1);
  });
});
