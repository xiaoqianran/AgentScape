// Cross-world capability experiment (extended).
//
// Builds on 003-cross-world-open-pickup-place.mjs. Adds three things that experiment does not cover:
//   1. the world-first magic cabin as a fourth real environment pack,
//   2. a genuinely layout-only adjustment mode (poses taken from environments.js coffeeCorner data),
//   3. scene-recovery consistency after acceptance (serialize -> drift -> restore -> re-validate).
//
// Scope guard: no product code is modified. Every stage is reported per case; a case that fails
// stays in the report instead of aborting the run.
//
// Run with:
//   node dev/experiments/world/004-cross-world-cabin-layout-recovery.mjs
import { readFile, writeFile } from 'node:fs/promises';
import * as THREE from 'three';

import { createAssetModule } from '../../../modules/asset/AssetModule.js';
import { assetManifests } from '../../../modules/asset/registry/manifests/index.js';
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
import { createMagicCabin } from '../../../modules/world/content/magicCabin.js';
import { ENVIRONMENTS } from '../../../modules/world/content/environments.js';
import { SkillRegistry } from '../../../application/skills/SkillRegistry.js';
import { registerCoreSkills } from '../../../application/skills/registerCoreSkills.js';
import { AgentTools } from '../../../application/AgentTools.js';
import { ToolCallingAgent } from '../../../modules/agent/ToolCallingAgent.js';
import { disposeObject3D } from '../../../modules/rendering/disposeObject3D.js';
import { cabinCanvasHost } from '../../../tests/helpers/cabinCanvasHost.js';

globalThis.ProgressEvent ||= class ProgressEvent { constructor(type, init = {}) { this.type = type; Object.assign(this, init); } };
globalThis.localStorage ||= { getItem: () => null, setItem() {}, removeItem() {} };

const round = (v, d = 3) => (Number.isFinite(v) ? Number(Number(v).toFixed(d)) : v);
const sleep = () => new Promise((resolve) => setTimeout(resolve, 0));

// magic-cabin is the only environment pack with a live animation/collider step; the curated packs
// rebuild nothing per frame, so only the cabin gets stepped.
const ENV_STEPS = new Set(['magic-cabin']);

const FACTORIES = {
  'monument-hall': createMonumentHall,
  'ruined-courtyard': createRuinedCourtyard,
  'woodland-workshop': createWoodlandWorkshop,
  'magic-cabin': () => createMagicCabin(cabinCanvasHost())
};

const declared = (id) => ENVIRONMENTS.find((entry) => entry.id === id).bootstrap;
const corner = (id) => ENVIRONMENTS.find((entry) => entry.id === id).coffeeCorner || null;

async function buildRuntime(worldId) {
  const cabinetBytes = await readFile('public/assets/cabinet.glb');
  const manifests = structuredClone(assetManifests);
  manifests.cabinet.source = { kind: 'glb', url: 'data:model/gltf-binary;base64,' + cabinetBytes.toString('base64') };
  const runtime = new WorldRuntime({
    environmentFactory: null,
    assetModule: createAssetModule({ manifests })
  });
  await runtime.physics.init();
  runtime.scene = new THREE.Scene();
  runtime.rendering = {
    viewPose: () => ({ position: [0, 0, 0], rotation: [0, 0, 0, 1] }),
    cameraState: () => ({ position: [0, 0, 0], target: [0, 0, -1] }),
    applyCameraState: () => true,
    update() {}
  };
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

async function stepFrame(runtime, driveEnvironment) {
  runtime.locomotion.update(1 / 60);
  runtime.physics.step(1 / 60, runtime.store);
  runtime.interactions.update(1 / 60, runtime.rendering.viewPose());
  if (driveEnvironment && typeof runtime.environment.step === 'function') {
    runtime.environment.step(1 / 60, { physics: runtime.physics, navigation: runtime.navigation });
  }
  runtime.sceneGraph.update();
}

async function settle(runtime, frames, driveEnvironment) {
  for (let i = 0; i < frames; i += 1) {
    await stepFrame(runtime, driveEnvironment);
    if (i % 12 === 0) await sleep(); else await Promise.resolve();
  }
}

async function driveAgent(promise, runtime, driveEnvironment, max = 9000) {
  let done = false, result = null, error = null;
  promise.then((v) => { done = true; result = v; }, (e) => { done = true; error = e; });
  for (let i = 0; i < max && !done; i += 1) {
    await stepFrame(runtime, driveEnvironment);
    if (i % 12 === 0) await sleep(); else await Promise.resolve();
  }
  if (error) throw error;
  return { done, result };
}

const TASK_CRITERIA = [
  { id: 'world-valid', kind: 'world-valid' },
  { id: 'agent-exists', kind: 'object-exists', targetId: 'agent_01' },
  { id: 'cabinet-open-verified', kind: 'interaction-verified', targetId: 'cabinet_01', capability: 'OPEN' },
  { id: 'cup-pickup-verified', kind: 'interaction-verified', targetId: 'cup_01', capability: 'PICKUP' },
  { id: 'cup-place-verified', kind: 'interaction-verified', targetId: 'table_01', capability: 'PLACE' },
  { id: 'cup-on-table', kind: 'relation-exists', subject: 'cup_01', predicate: 'ON', object: 'table_01', surfaceId: 'top' },
  { id: 'no-unresolved', kind: 'no-unresolved' }
];

// Recovery must not forge fresh interaction evidence, so the restored world is judged on
// persistent state only.
const PERSIST_CRITERIA = [
  { id: 'world-valid', kind: 'world-valid' },
  { id: 'agent-exists', kind: 'object-exists', targetId: 'agent_01' },
  { id: 'cabinet-exists', kind: 'object-exists', targetId: 'cabinet_01' },
  { id: 'cup-exists', kind: 'object-exists', targetId: 'cup_01' },
  { id: 'table-exists', kind: 'object-exists', targetId: 'table_01' },
  { id: 'cup-on-table', kind: 'relation-exists', subject: 'cup_01', predicate: 'ON', object: 'table_01', surfaceId: 'top' },
  { id: 'no-unresolved', kind: 'no-unresolved' }
];

// Four layout modes. Only `coffee-corner` is a pure layout-data adjustment: every pose comes from
// the environments.js declaration and no code path is special-cased for the task.
function worldIR({ worldId, layout, boot, cornerPose, agentPoseOverride }) {
  const pose = (p) => (p ? { transform: { position: p } } : {});
  let agentPose = null, cabinetPose = null, tablePose = null, cupPose = null, cupInCabinet = false;
  if (layout === 'declared-bootstrap') {
    agentPose = boot.agent; cabinetPose = boot.cabinet; tablePose = boot.table; cupPose = boot.cup;
  } else if (layout === 'task-adjusted') {
    agentPose = boot.agent; cabinetPose = boot.cabinet; tablePose = boot.table; cupInCabinet = true;
  } else if (layout === 'coffee-corner') {
    // Only the props come from the world's coffee-corner data. The agent spawn is validated against
    // the task targets after the first build, because a world can gate traversal in a way the
    // composer cannot know: magic-cabin's front door starts closed, and 005 proved its interior and
    // the outdoor props sit in separate Recast components while it is shut. When the composer's
    // spawn cannot reach the targets, runCase retries with the world-declared spawn.
    agentPose = agentPoseOverride === undefined ? null : agentPoseOverride;
    cabinetPose = cornerPose ? cornerPose.cabinet : boot.cabinet;
    tablePose = cornerPose ? cornerPose.table : boot.table;
    cupInCabinet = true;
  } else {
    cupInCabinet = true;
  }
  const entities = [
    { id: 'agent_01', asset: { assetId: 'agent' }, ...pose(agentPose), capabilityIntent: [], initialState: {} },
    { id: 'cabinet_01', asset: { assetId: 'cabinet' }, ...pose(cabinetPose), capabilityIntent: ['OPEN'], initialState: {} },
    { id: 'table_01', asset: { assetId: 'table' }, ...pose(tablePose), capabilityIntent: [], initialState: {} }
  ];
  entities.push(cupInCabinet
    ? { id: 'cup_01', asset: { assetId: 'cup' }, capabilityIntent: ['PICKUP'], initialState: {} }
    : { id: 'cup_01', asset: { assetId: 'cup' }, ...pose(cupPose), capabilityIntent: ['PICKUP'], initialState: {} });
  return {
    schema: 'agentscape.world-ir', schemaVersion: 1,
    revision: { id: 'xworld4-' + worldId + '-' + layout, reason: 'cross-world cabin + layout + recovery probe' },
    provenance: { source: 'probe-xworld-004', createdBy: 'AgentScape', evidenceRefs: [] },
    intent: { name: 'Cross-world cabin task', description: 'Open the cabinet, take the cup, carry it, place it on the table.' },
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

const doorStateOf = (runtime) => {
  const object = runtime.store.get('cabinet_01');
  return object && object.state && object.state.parts ? object.state.parts.door : null;
};

// The layout gate this experiment probes: can the agent actually walk to the task targets?
// World admission already checks footprint overlap and single-pose blocking, but not reachability
// between the agent spawn and the interaction targets.
async function probeTargets(runtime, driveEnvironment) {
  // Reachability must be measured on a settled navigation state. magic-cabin syncs its moving door
  // and platform colliders inside environment.step(), so querying before any frame has been stepped
  // bakes a wrong navmesh and reports false unreachability. 005 used the same settle-first order.
  await settle(runtime, 30, driveEnvironment);
  const spawn = runtime.physics.getPosition('agent_01');
  const cabinet = runtime.physics.getPosition('cabinet_01');
  const table = runtime.physics.getPosition('table_01');
  const toCabinet = await runtime.navigation.findPath(spawn, cabinet);
  const toTable = await runtime.navigation.findPath(spawn, table);
  const toCabinetAgain = await runtime.navigation.findPath(spawn, cabinet);
  return {
    spawn: spawn.map((value) => round(value)),
    toCabinet: toCabinet.reachable === true,
    toCabinetAgain: toCabinetAgain.reachable === true,
    toTable: toTable.reachable === true,
    allReachable: toCabinet.reachable === true && toTable.reachable === true
  };
}

const safeCall = async (fn, fallbackLabel) => {
  try { return await fn(); } catch (error) { return { error: fallbackLabel + ':' + String(error && error.message ? error.message : error).slice(0, 160) }; }
};

async function recoveryConsistency(runtime, tools, driveEnvironment) {
  const snapshot = await runtime.serialize({ name: 'probe-accepted' });
  const recorded = { snapshotObjects: snapshot.objects ? snapshot.objects.length : null };
  await runtime.mutate('probe:inject-drift', () => runtime.interactions.move('cup_01', [0, 0, 0]));
  runtime.sceneGraph.changed(); runtime.sceneGraph.update();
  const drift = await safeCall(() => tools.call('replayWorldAcceptance'), 'drift-replay');
  recorded.driftDetected = drift.status === 'world-incomplete';
  recorded.driftFailedCount = drift.failedCount === undefined ? null : drift.failedCount;

  await runtime.restore(snapshot);
  await settle(runtime, 180, driveEnvironment);
  runtime.sceneGraph.changed(); runtime.sceneGraph.update();

  const restored = await safeCall(() => tools.call('evaluateWorldAcceptance', { criteria: PERSIST_CRITERIA }), 'restored-acceptance');
  recorded.restoredPersistent = restored.status === undefined ? restored.error : restored.status;
  recorded.restoredVerified = restored.verifiedCount === undefined ? null : restored.verifiedCount;
  recorded.restoredFailed = restored.failedCount === undefined ? null : restored.failedCount;
  const support = await safeCall(() => Promise.resolve(runtime.spatial.supportGeometry('cup_01', 'table_01', { surfaceId: 'top' })), 'restored-support');
  recorded.restoredSupportOn = support.supported === undefined ? null : support.supported;
  recorded.restoredSupportGap = support.gap === undefined ? null : round(support.gap);

  const historical = await safeCall(() => tools.call('replayWorldAcceptance'), 'historical-replay');
  recorded.restoredHistorical = historical.status === undefined ? historical.error : historical.status;
  recorded.restoredHistoricalForged = Array.isArray(historical.checks)
    ? historical.checks.some((check) => check.verified === true && check.kind === 'interaction-verified')
    : null;
  return recorded;
}

async function runCase(worldId, layout) {
  const boot = declared(worldId);
  const cornerPose = corner(worldId);
  const driveEnvironment = ENV_STEPS.has(worldId);
  const row = {
    worldId, layout, driveEnvironment,
    bootstrap: { agent: boot.agent, table: boot.table, cabinet: boot.cabinet, cup: boot.cup },
    corner: cornerPose ? { table: cornerPose.table, cabinet: cornerPose.cabinet } : null
  };
  let handle = null;
  try {
    handle = await buildRuntime(worldId);
    const { runtime, worldBuilder } = handle;
    const tools = new AgentTools(runtime, { profile: 'builder', actor: 'agent_01' });
    let build = await worldBuilder.run(worldIR({ worldId, layout, boot, cornerPose }));
    let admissionReport = build.pipeline.state.reports.worldAdmission;
    row.objects = runtime.store.list().length;
    if (row.objects === 0) {
      row.worldAdmission = admissionReport.status;
      row.worldAdmissionReasons = admissionReport.reasons || [];
      row.admissionDetail = JSON.stringify(admissionReport).slice(0, 700);
      row.skipped = 'no objects instantiated; task not attempted';
      return row;
    }
    runtime.sceneGraph.changed(); runtime.sceneGraph.update();

    // Composer spawn validation. coffee-corner is the only mode that hands the agent spawn to the
    // composer while taking props from world data, so it is where a cross-component spawn can hide.
    if (layout === 'coffee-corner') {
      const spawn = await probeTargets(runtime, driveEnvironment);
      row.agentSpawnCheck = spawn;
      if (!spawn.allReachable) {
        build = await worldBuilder.run(worldIR({ worldId, layout, boot, cornerPose, agentPoseOverride: boot.agent }));
        admissionReport = build.pipeline.state.reports.worldAdmission;
        row.agentFallback = { reason: 'composer spawn cannot reach task targets', spawn: spawn.spawn, used: boot.agent };
        row.objects = runtime.store.list().length;
        if (row.objects === 0) {
          row.worldAdmission = admissionReport.status;
          row.worldAdmissionReasons = admissionReport.reasons || [];
          row.skipped = 'fallback spawn produced no objects';
          return row;
        }
        runtime.sceneGraph.changed(); runtime.sceneGraph.update();
        row.agentSpawnCheckAfterFallback = await probeTargets(runtime, driveEnvironment);
      }
    }

    row.worldAdmission = admissionReport.status;
    row.worldAdmissionReasons = admissionReport.reasons || [];
    row.admissionDetail = JSON.stringify(admissionReport).slice(0, 700);
    row.cupStart = layout === 'declared-bootstrap'
      ? 'declared bootstrap ' + JSON.stringify(boot.cup)
      : 'INSIDE cabinet interior = ' + runtime.sceneGraph.list({ subject: 'cup_01', predicate: 'INSIDE', object: 'cabinet_01' }).length;

    const approach = await runtime.navigation.findPath(runtime.physics.getPosition('agent_01'), runtime.physics.getPosition('cabinet_01'));
    row.agentToCabinet = { reachable: approach.reachable, points: approach.path ? approach.path.length : 0, cost: round(approach.cost) };

    const sequence = [
      ['approachAndInteract', { actorId: 'agent_01', targetId: 'cabinet_01', action: 'open' }],
      ['approachAndPickup', { actorId: 'agent_01', targetId: 'cup_01' }],
      ['approachAndPlace', { actorId: 'agent_01', supportId: 'table_01', surfaceId: 'top' }],
      ['evaluateWorldAcceptance', { criteria: TASK_CRITERIA }]
    ];
    const gateway = {
      isConfigured: () => true,
      async complete({ messages }) {
        const done = messages.filter((m) => m.role === 'tool').length;
        const next = sequence[done];
        return next ? { message: '', toolCalls: [{ id: 'x4_' + done, name: next[0], args: next[1] }] } : { message: 'done', toolCalls: [] };
      }
    };
    const agent = new ToolCallingAgent({ tools, gateway, maxSteps: 8 });
    const start = runtime.physics.getPosition('agent_01');
    const drive = await driveAgent(agent.run('open cabinet_01, pick up cup_01, carry it to table_01 and place it on top, then prove it with the world acceptance criteria.'), runtime, driveEnvironment);
    row.settled = drive.done;
    const end = runtime.physics.getPosition('agent_01');
    row.agentTravel = round(Math.hypot(end[0] - start[0], end[2] - start[2]));
    row.taskStatus = drive.result ? drive.result.taskStatus : null;
    const bundle = drive.result && drive.result.acceptanceBundle && drive.result.acceptanceBundle.result;
    row.acceptance = bundle ? { status: bundle.status, verified: bundle.verifiedCount, failed: bundle.failedCount } : null;
    row.acceptanceFailures = bundle && Array.isArray(bundle.checks)
      ? bundle.checks.filter((c) => c.verified === false).map((c) => c.id + ':' + (c.reason || c.kind))
      : null;

    const doorBefore = doorStateOf(runtime);
    await settle(runtime, 60, driveEnvironment);
    const doorAfter = doorStateOf(runtime);
    row.door = { reached: doorBefore, stable: doorBefore === doorAfter, afterSettle: doorAfter };

    row.cupHeldBy = runtime.store.get('cup_01').state.heldBy || 'none';
    row.hands = runtime.interactions.carryStatus('agent_01').status;
    const support = runtime.spatial.supportGeometry('cup_01', 'table_01', { surfaceId: 'top' });
    row.supportOnTable = { supported: support.supported, gap: round(support.gap) };
    const executed = runtime.trace.list({ type: 'agent.sequence' }).map((e) => e.payload).filter((e) => e.executed === true);
    row.mutations = executed.filter((e) => ['approachAndInteract', 'approachAndPickup', 'approachAndPlace'].includes(e.tool))
      .map((e) => e.tool + '=' + (e.outcome && e.outcome.state) + (e.outcome && e.outcome.status ? '/' + e.outcome.status : ''));

    row.recovery = await recoveryConsistency(runtime, tools, driveEnvironment);
    row.navigationDiagnostics = await safeCall(() => Promise.resolve(runtime.navigation.status()), 'nav-status');
    row.environmentDiagnostics = typeof runtime.environment.diagnostics === 'function'
      ? await safeCall(() => Promise.resolve(runtime.environment.diagnostics()), 'env-diagnostics')
      : { unsupported: true };
  } catch (error) {
    row.error = String(error && error.message ? error.message : error).slice(0, 260);
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

const worlds = ['monument-hall', 'ruined-courtyard', 'woodland-workshop', 'magic-cabin'];
const layouts = ['declared-bootstrap', 'task-adjusted', 'coffee-corner', 'auto-placed'];
const rows = [];
for (const worldId of worlds) {
  for (const layout of layouts) {
    const row = await runCase(worldId, layout);
    rows.push(row);
    console.log('--- ' + worldId + ' / ' + layout + ' ---');
    console.log(JSON.stringify(row));
  }
}

const summary = rows.map((r) => ({
  world: r.worldId, layout: r.layout, admission: r.worldAdmission,
  navToCabinet: r.agentToCabinet && r.agentToCabinet.reachable,
  task: r.taskStatus, acceptance: r.acceptance && r.acceptance.status,
  door: r.door && r.door.reached, doorStable: r.door && r.door.stable,
  heldBy: r.cupHeldBy && typeof r.cupHeldBy === 'object' ? 'agent' : r.cupHeldBy,
  hands: r.hands, onTable: r.supportOnTable && r.supportOnTable.on,
  restored: r.recovery && r.recovery.restoredPersistent,
  restoredSupport: r.recovery && r.recovery.restoredSupportOn,
  travel: r.agentTravel, error: r.error || ''
}));
console.log('=== SUMMARY ===');
console.table(summary);

const report = {
  schema: 'agentscape.cross-world-experiment', schemaVersion: 1,
  experiment: 'dev/experiments/world/004-cross-world-cabin-layout-recovery',
  mode: 'offline-deterministic',
  worlds, layouts,
  rows, summary,
  generatedAt: new Date().toISOString()
};
await writeFile(new URL('./004-results.json', import.meta.url), JSON.stringify(report, null, 2));
console.log('wrote 004-results.json');
process.exit(0);
