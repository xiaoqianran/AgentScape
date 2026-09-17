// Cross-world capability experiment: run the SAME embodied task (open cabinet -> take the cup from
// its interior -> carry -> place on the table) in three real environment packs, under three layout
// modes, and report every stage.
//
// Reuses the production chain from 002-world-viability.mjs: WorldIR -> WorldBuilder -> admission ->
// real Recast navigation -> Rapier -> InteractionSystem -> world acceptance evidence.
//
// Layout modes:
//   declared-bootstrap  assert exactly the poses environments.js declares
//   task-adjusted       same poses, but the cup starts INSIDE the cabinet interior
//   auto-placed         assert no poses at all; let the composer place everything
//
// Measured result: the declared bootstrap poses are inadmissible in all three worlds
// (BATCH_FOOTPRINT_OVERLAP in monument-hall, WORLD_POSE_BLOCKED in the others), while auto-placement
// lets two of the three complete the task with world-accepted evidence. The interaction layer itself
// is unchanged in every mode: same cabinet/cup/table manifests, same capabilities.
//
// Read-only. Run with `node dev/experiments/world/003-cross-world-open-pickup-place.mjs`.
import { readFile } from 'node:fs/promises';
import * as THREE from 'three';

import { createAssetModule } from '../../../modules/asset/AssetModule.js';
import { assetManifests } from '../../../modules/asset/manifests/index.js';
import { WorldRuntime } from '../../../modules/world/runtime/WorldRuntime.js';
import { SpatialSystem } from '../../../modules/world/runtime/systems/SpatialSystem.js';
import { NavigationSystem } from '../../../modules/world/runtime/systems/NavigationSystem.js';
import { LocomotionSystem } from '../../../modules/world/runtime/systems/LocomotionSystem.js';
import { InteractionSystem } from '../../../modules/world/runtime/systems/InteractionSystem.js';
import { RecastNavigationBackend } from '../../../modules/navigation/RecastNavigationBackend.js';
import { SceneGraph } from '../../../modules/world/runtime/graph/SceneGraph.js';
import { CommandHistory } from '../../../modules/world/runtime/CommandHistory.js';
import { WorldValidator } from '../../../modules/world/verification/WorldValidator.js';
import { RepairEngine } from '../../../modules/world/verification/RepairEngine.js';
import { WorldBuilder } from '../../../modules/world/build/WorldBuilder.js';
import { createMonumentHall } from '../../../modules/world/content/monumentHall.js';
import { createRuinedCourtyard } from '../../../modules/world/content/ruinedCourtyard.js';
import { createWoodlandWorkshop } from '../../../modules/world/content/woodlandWorkshop.js';
import { ENVIRONMENTS } from '../../../modules/world/content/environments.js';
import { SkillRegistry } from '../../../application/skills/SkillRegistry.js';
import { registerCoreSkills } from '../../../application/skills/registerCoreSkills.js';
import { AgentTools } from '../../../application/AgentTools.js';
import { ToolCallingAgent } from '../../../modules/agent/ToolCallingAgent.js';
import { disposeObject3D } from '../../../modules/rendering/disposeObject3D.js';

globalThis.ProgressEvent ||= class ProgressEvent { constructor(type, init = {}) { this.type = type; Object.assign(this, init); } };
globalThis.localStorage ||= { getItem: () => null, setItem() {}, removeItem() {} };

const round = (v, d = 3) => (Number.isFinite(v) ? Number(Number(v).toFixed(d)) : v);
const sleep = () => new Promise((resolve) => setTimeout(resolve, 0));

const FACTORIES = {
  'monument-hall': createMonumentHall,
  'ruined-courtyard': createRuinedCourtyard,
  'woodland-workshop': createWoodlandWorkshop
};

const declared = (id) => ENVIRONMENTS.find((entry) => entry.id === id).bootstrap;

async function buildRuntime(worldId) {
  const cabinetBytes = await readFile('public/assets/cabinet.glb');
  const manifests = structuredClone(assetManifests);
  manifests.cabinet.source = { kind: 'glb', url: `data:model/gltf-binary;base64,${cabinetBytes.toString('base64')}` };
  const runtime = new WorldRuntime({
    environmentFactory: null,
    assetModule: createAssetModule({ manifests })
  });
  await runtime.physics.init();
  runtime.scene = new THREE.Scene();
  runtime.rendering = { viewPose: () => ({ position: [0, 0, 0], rotation: [0, 0, 0, 1] }), cameraState: () => ({ position: [0, 0, 0], target: [0, 0, -1] }), applyCameraState: () => true, update() {} };
  const environment = FACTORIES[worldId]({ scene: runtime.scene, loadAssets: false });
  runtime.environment = environment;
  runtime.scene.add(environment.root);
  runtime.environmentFloor = environment.floor;
  runtime.physics.addEnvironment(environment.colliders, { id: environment.id });
  runtime.spatial = new SpatialSystem({ store: runtime.store, scene: runtime.scene });
  runtime.sceneGraph = new SceneGraph({ store: runtime.store, spatial: runtime.spatial, events: runtime.events });
  runtime.history = new CommandHistory({ apply: (scene) => runtime.restore(scene), events: runtime.events });
  runtime.validator = new WorldValidator(runtime);
  runtime.repair = new RepairEngine(runtime);
  runtime.navigation = new NavigationSystem({ store: runtime.store, physics: runtime.physics, environmentRoots: [environment.root], events: runtime.events, backend: new RecastNavigationBackend() });
  runtime.locomotion = new LocomotionSystem({ store: runtime.store, physics: runtime.physics, navigation: runtime.navigation, events: runtime.events });
  runtime.interactions = new InteractionSystem({ store: runtime.store, physics: runtime.physics, spatial: runtime.spatial, navigation: runtime.navigation, locomotion: runtime.locomotion, events: runtime.events });
  const worldBuilder = new WorldBuilder(runtime);
  runtime.skills = registerCoreSkills(new SkillRegistry({ policy: runtime.policy, trace: runtime.trace, runtime }), runtime, { worldBuilder });
  runtime.ruleRuntime.start();
  return { runtime, worldBuilder };
}

async function driveAgent(promise, runtime, max = 9000) {
  let done = false, result = null, error = null;
  promise.then((v) => { done = true; result = v; }, (e) => { done = true; error = e; });
  for (let i = 0; i < max && !done; i += 1) {
    runtime.locomotion.update(1 / 60);
    runtime.physics.step(1 / 60, runtime.store);
    runtime.interactions.update(1 / 60, runtime.rendering.viewPose());
    runtime.sceneGraph.update();
    if (i % 12 === 0) await sleep(); else await Promise.resolve();
  }
  if (error) throw error;
  return { done, result };
}

const CRITERIA = [
  { id: 'world-valid', kind: 'world-valid' },
  { id: 'agent-exists', kind: 'object-exists', targetId: 'agent_01' },
  { id: 'cabinet-open-verified', kind: 'interaction-verified', targetId: 'cabinet_01', capability: 'OPEN' },
  { id: 'cup-pickup-verified', kind: 'interaction-verified', targetId: 'cup_01', capability: 'PICKUP' },
  { id: 'cup-place-verified', kind: 'interaction-verified', targetId: 'table_01', capability: 'PLACE' },
  { id: 'cup-on-table', kind: 'relation-exists', subject: 'cup_01', predicate: 'ON', object: 'table_01', surfaceId: 'top' },
  { id: 'no-unresolved', kind: 'no-unresolved' }
];

function worldIR({ worldId, layout, boot }) {
  const cupInCabinet = layout !== 'declared-bootstrap';
  const explicit = layout !== 'auto-placed';
  const at = (key) => (explicit ? { transform: { position: boot[key] } } : {});
  const entities = [
    { id: 'agent_01', asset: { assetId: 'agent' }, ...at('agent'), capabilityIntent: [], initialState: {} },
    { id: 'cabinet_01', asset: { assetId: 'cabinet' }, ...at('cabinet'), capabilityIntent: ['OPEN'], initialState: {} },
    { id: 'table_01', asset: { assetId: 'table' }, ...at('table'), capabilityIntent: [], initialState: {} }
  ];
  // Declared layout keeps the cup wherever the world says it is; the other layouts put it in the
  // cabinet, and auto-placed hands every pose to the composer instead of asserting one.
  entities.push(cupInCabinet
    ? { id: 'cup_01', asset: { assetId: 'cup' }, capabilityIntent: ['PICKUP'], initialState: {} }
    : { id: 'cup_01', asset: { assetId: 'cup' }, transform: { position: boot.cup }, capabilityIntent: ['PICKUP'], initialState: {} });
  return {
    schema: 'agentscape.world-ir', schemaVersion: 1,
    revision: { id: `xworld-${worldId}-${layout}`, reason: 'cross-world open/pickup/place probe' },
    provenance: { source: 'probe-xworld', createdBy: 'AgentScape', evidenceRefs: [] },
    intent: { name: 'Cross-world task', description: 'Open the cabinet, take the cup, carry it, place it on the table.' },
    policy: { generation: { generate: false }, physics: { fallbackPolicy: 'deny' } },
    entities,
    spatial: { relations: cupInCabinet ? [{ subject: 'cup_01', predicate: 'INSIDE', object: 'cabinet_01', receptacleId: 'interior' }] : [], constraints: [] },
    interactions: [
      { id: 'open-cabinet', actorId: 'agent_01', targetId: 'cabinet_01', capability: 'OPEN' },
      { id: 'pickup-cup', actorId: 'agent_01', targetId: 'cup_01', capability: 'PICKUP' },
      { id: 'place-cup', actorId: 'agent_01', supportId: 'table_01', capability: 'PLACE' }
    ],
    rules: [], acceptance: []
  };
}

async function runCase(worldId, layout) {
  const boot = declared(worldId);
  const row = { worldId, layout, bootstrap: { agent: boot.agent, table: boot.table, cabinet: boot.cabinet, cup: boot.cup } };
  let handle = null;
  try {
    handle = await buildRuntime(worldId);
    const { runtime, worldBuilder } = handle;
    const tools = new AgentTools(runtime, { profile: 'builder', actor: 'agent_01' });
    const build = await worldBuilder.run(worldIR({ worldId, layout, boot }));
    const pipeline = build.pipeline;
    const admissionReport = pipeline.state.reports.worldAdmission;
    row.worldAdmission = admissionReport.status;
    row.worldAdmissionReasons = admissionReport.reasons;
    row.admissionDetail = JSON.stringify(admissionReport).slice(0, 700);
    row.objects = runtime.store.list().length;
    if (row.objects === 0) {
      row.skipped = 'no objects instantiated; task not attempted';
      return row;
    }
    runtime.sceneGraph.changed(); runtime.sceneGraph.update();
    row.cupStart = layout !== 'declared-bootstrap'
      ? `INSIDE cabinet interior = ${runtime.sceneGraph.list({ subject: 'cup_01', predicate: 'INSIDE', object: 'cabinet_01' }).length}`
      : `placed at declared bootstrap ${JSON.stringify(boot.cup)}`;

    const approach = await runtime.navigation.findPath(runtime.physics.getPosition('agent_01'), runtime.physics.getPosition('cabinet_01'));
    row.agentToCabinet = { reachable: approach.reachable, points: approach.path ? approach.path.length : 0, cost: round(approach.cost) };

    const sequence = [
      ['approachAndInteract', { actorId: 'agent_01', targetId: 'cabinet_01', action: 'open' }],
      ['approachAndPickup', { actorId: 'agent_01', targetId: 'cup_01' }],
      ['approachAndPlace', { actorId: 'agent_01', supportId: 'table_01', surfaceId: 'top' }],
      ['evaluateWorldAcceptance', { criteria: CRITERIA }]
    ];
    const gateway = {
      isConfigured: () => true,
      async complete({ messages }) {
        const done = messages.filter((m) => m.role === 'tool').length;
        const next = sequence[done];
        return next ? { message: '', toolCalls: [{ id: `x_${done}`, name: next[0], args: next[1] }] } : { message: 'done', toolCalls: [] };
      }
    };
    const agent = new ToolCallingAgent({ tools, gateway, maxSteps: 8 });
    const start = runtime.physics.getPosition('agent_01');
    const drive = await driveAgent(agent.run('open cabinet_01, pick up cup_01, carry it to table_01 and place it on top, then prove it with the world acceptance criteria.'), runtime);
    row.settled = drive.done;
    const end = runtime.physics.getPosition('agent_01');
    row.agentTravel = round(Math.hypot(end[0] - start[0], end[2] - start[2]));
    row.taskStatus = drive.result ? drive.result.taskStatus : null;
    row.acceptance = drive.result && drive.result.acceptanceBundle && drive.result.acceptanceBundle.result
      ? { status: drive.result.acceptanceBundle.result.status, verified: drive.result.acceptanceBundle.result.verifiedCount, failed: drive.result.acceptanceBundle.result.failedCount }
      : null;
    row.doorState = runtime.store.get('cabinet_01') && runtime.store.get('cabinet_01').state.parts ? runtime.store.get('cabinet_01').state.parts.door : null;
    row.cupHeldBy = runtime.store.get('cup_01').state.heldBy || 'none';
    row.hands = runtime.interactions.carryStatus('agent_01').status;
    const support = runtime.spatial.supportGeometry('cup_01', 'table_01', { surfaceId: 'top' });
    row.supportOnTable = { supported: support.supported, gap: round(support.gap) };
    const executed = runtime.trace.list({ type: 'agent.sequence' }).map((e) => e.payload).filter((e) => e.executed === true);
    row.mutations = executed.filter((e) => ['approachAndInteract', 'approachAndPickup', 'approachAndPlace'].includes(e.tool))
      .map((e) => e.tool + '=' + (e.outcome && e.outcome.state) + (e.outcome && e.outcome.status ? '/' + e.outcome.status : ''));
  } catch (error) {
    row.error = String(error && error.message ? error.message : error).slice(0, 220);
  } finally {
    if (handle && handle.runtime) {
      const { runtime } = handle;
      try { runtime.ruleRuntime.stop(); } catch {}
      try { runtime.locomotion && runtime.locomotion.cancelAll && runtime.locomotion.cancelAll(); } catch {}
      try { runtime.navigation && runtime.navigation.dispose(); } catch {}
      try { runtime.physics && runtime.physics.dispose(); } catch {}
      try { runtime.environment && runtime.environment.dispose(); } catch {}
      try { disposeObject3D(runtime.scene); } catch {}
    }
  }
  return row;
}

const worlds = ['monument-hall', 'ruined-courtyard', 'woodland-workshop'];
const layouts = ['declared-bootstrap', 'task-adjusted', 'auto-placed'];
const rows = [];
for (const worldId of worlds) {
  for (const layout of layouts) {
    const row = await runCase(worldId, layout);
    rows.push(row);
    console.log('--- ' + worldId + ' / ' + layout + ' ---');
    console.log(JSON.stringify(row));
  }
}
console.log('=== SUMMARY ===');
console.table(rows.map((r) => ({
  world: r.worldId, layout: r.layout, admission: r.worldAdmission, navToCabinet: r.agentToCabinet && r.agentToCabinet.reachable,
  task: r.taskStatus, acceptance: r.acceptance && r.acceptance.status, door: r.doorState, heldBy: r.cupHeldBy, hands: r.hands,
  onTable: r.supportOnTable && r.supportOnTable.on, travel: r.agentTravel, error: r.error || ''
})));
process.exit(0);
