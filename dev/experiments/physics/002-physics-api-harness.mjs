/**
 * Standalone physics harness — no browser, no renderer, no Observatory shell.
 *
 * It drives the same production `PhysicsSystem` and the same declarative API surface
 * (`modules/physics/PhysicsApiSurface.js`) that the Observatory workbench consumes, so the two
 * can never drift while neither needs the other:
 *
 *   phase 1  API surface   — invoke every declared capability once and report ok / error
 *   phase 2  scenarios     — run every physics scenario on both backends and check assertions
 *
 * Usage:
 *   node dev/experiments/physics/002-physics-api-harness.mjs
 *   node dev/experiments/physics/002-physics-api-harness.mjs --only=api
 *   node dev/experiments/physics/002-physics-api-harness.mjs --only=scenarios --backend=jolt
 *   node dev/experiments/physics/002-physics-api-harness.mjs --json
 *
 * Exit code is non-zero when any check fails, so it can be used as a gate.
 */
import * as THREE from 'three';
import process from 'node:process';
import { performance } from 'node:perf_hooks';
import { PhysicsScenarioContext } from '../../../apps/observatory/labs/physics/PhysicsScenarioContext.js';
import { createPhysicsBackend, PHYSICS_BACKENDS } from '../../../apps/observatory/labs/physics/backends.js';
import { physicsScenarios } from '../../../apps/observatory/labs/physics/scenarios/index.js';
import { studioScenarios } from '../../../apps/observatory/labs/physics-studio/scenarios/index.js';
import { PhysicsSystem } from '../../../modules/world/runtime/systems/PhysicsSystem.js';
import {
  PHYSICS_API_CATALOG,
  invokePhysicsApi,
  physicsApiCoverage
} from '../../../modules/physics/PhysicsApiSurface.js';

const EXECUTABLE_BACKENDS = PHYSICS_BACKENDS.filter((backend) => backend.id !== 'compare').map((backend) => backend.id);

const CUP_MANIFEST = {
  id:'harness-fixture', source:{ kind:'builtin' },
  physics:{ body:'fixed', colliders:[{ shape:'box', halfExtents:[0.45, 0.45, 0.45] }] }
};

/** Explicit arguments for every capability that needs an object to act on. */
const ARGUMENTS = {
  'workbench.spawnBox':{ id:'smoke_box', position:[0, 4, 0], halfExtents:[0.3, 0.3, 0.3] },
  'workbench.spawnAsset':{ id:'smoke_asset', assetId:'cup', position:[0, 4, 0] },
  'workbench.remove':{ id:'smoke_asset' },
  'workbench.step':{ frames:2 },
  'workbench.manifestSnapshot':{},
  'workbench.truthComparison':{},

  'physics.getPosition':{ id:'box_01' },
  'physics.getRotation':{ id:'box_01' },
  'physics.setPosition':{ id:'box_01', position:[0, 3, 0] },
  'physics.beginTransform':{ id:'box_01' },
  'physics.syncTransform':{ id:'box_01' },
  'physics.endTransform':{ id:'box_01' },

  'physics.getMotion':{ id:'box_01' },
  'physics.setMotion':{ id:'box_01', linearVelocity:[0, 0, 0], angularVelocity:[0, 0, 0] },
  'physics.applyImpulse':{ id:'box_01', impulse:[0.2, 0, 0] },
  'physics.applyForce':{ id:'box_01', force:[1, 0, 0] },
  'physics.applyTorque':{ id:'box_01', torque:[0, 1, 0] },
  'physics.setMaterial':{ id:'box_01', friction:0.6, restitution:0.2 },
  'physics.setDynamics':{ id:'box_01', linearDamping:0.05, angularDamping:0.05, gravityScale:1 },
  'physics.setCcd':{ id:'box_01', enabled:true },
  'physics.sleep':{ id:'box_01' },
  'physics.wake':{ id:'box_01' },

  'physics.setSensor':{ id:'box_01', enabled:true },
  'physics.setCollisionFilter':{ id:'box_01', groups:['prop'], collidesWith:['environment', 'prop'] },
  'physics.getCollisionEvents':{ clear:true },
  'physics.getNavigationObstacles':{},

  'physics.checkBodyPose':{ id:'actor_01', targetPosition:[0, 0, 0] },
  'physics.checkBodyMotion':{ id:'actor_01', targetPosition:[0, 0, 0] },
  'physics.checkManifestPose':{ manifest:CUP_MANIFEST, targetPosition:[0, 1, 0] },
  'physics.raycast':{ origin:[-4, 1, 0], target:[4, 1, 0] },

  'physics.moveCharacter':{ id:'actor_01', desiredTranslation:[0.02, -0.01, 0] },
  'physics.cancelCharacterMovement':{ id:'actor_01' },
  'physics.faceCharacter':{ id:'actor_01', direction:[1, 0, 0] },
  'physics.setCharacterYaw':{ id:'actor_01', yaw:0.5 },
  'physics.setCharacterControllerOptions':{ offset:0.02, snapToGround:0.3 },

  'physics.setHeld':{ id:'box_01', held:false },
  'physics.setHeldTarget':{ id:'box_01', target:[0, 1, 0] },
  'physics.setHeldPose':{ id:'box_01', position:[0, 1, 0] },
  'physics.anchorPose':{ id:'box_01' },

  'physics.getArticulationState':{ id:'cabinet_01', partName:'door', target:-1 },
  'physics.setArticulationTarget':{ id:'cabinet_01', partName:'door', target:-1 },
  'physics.holdArticulationCurrent':{ id:'cabinet_01', partName:'door' },
  'physics.articulationContacts':{ id:'cabinet_01', partName:'door' },
  'physics.articulationPenetrations':{ id:'cabinet_01', partName:'door', refresh:true },
  'physics.getPartRestPose':{ id:'cabinet_01', partName:'door' },
  'physics.articulationColliderPoses':{ id:'cabinet_01', partName:'door', coordinate:-0.5 },

  'physics.articulationCounterfactualSampleCount':{ id:'cabinet_01', partName:'door', current:0, target:-1 },
  'physics.articulationPairCounterfactual':{ originalId:'cabinet_01', originalPartName:'door', originalTarget:0, blockerId:'cabinet_01', blockerPartName:'door', blockerTarget:-1 },
  'physics.articulationWorldCounterfactual':{ id:'cabinet_01', partName:'door', target:-1 },
  'physics.articulationPairCounterfactualConvergence':{ originalId:'cabinet_01', originalPartName:'door', originalTarget:0, blockerId:'cabinet_01', blockerPartName:'door', blockerTarget:-1 },

  'physics.profile':{},
  'physics.debugSnapshot':{ contacts:true },
  'physics.runtimeCapabilities':{},
  'physics.runtimeExecutionModes':{},
  'physics.hasCapability':{ capability:'collision' },
  'physics.supportsExecutionMode':{ mode:'realtime' },
  'physics.shapeBoundingRadius':{ shape:{ kind:'box', halfExtents:[0.5, 0.5, 0.5] } }
};

const parseArgs = (argv = []) => {
  const options = { only:'all', backend:null, json:false, help:false };
  for (const raw of argv) {
    if (raw === '--json') options.json = true;
    else if (raw === '--help' || raw === '-h') options.help = true;
    else if (raw.startsWith('--only=')) options.only = raw.slice('--only='.length);
    else if (raw.startsWith('--backend=')) options.backend = raw.slice('--backend='.length);
  }
  return options;
};

const HELP = `Standalone physics harness (no browser, no renderer).

  --only=all|api|scenarios   which phase to run (default: all)
  --backend=rapier|jolt      restrict scenario phase to one backend (default: both)
  --json                     machine-readable output
  -h, --help                 this text
`;

/** Minimal headless fixture set: every capability has something real to act on. */
async function createHarnessContext(backendId) {
  const backend = await createPhysicsBackend(backendId);
  const ctx = await new PhysicsScenarioContext({ scene:new THREE.Scene(), backend }).init();
  ctx.addBox({ id:'floor', type:'fixed', position:[0, -0.1, 0], halfExtents:[5, 0.1, 4], friction:0.8 });
  ctx.addBox({ id:'box_01', position:[0, 3, 0], halfExtents:[0.4, 0.4, 0.4] });
  ctx.addBox({ id:'wall_01', type:'fixed', position:[1.5, 1.5, 0], halfExtents:[0.1, 1.5, 2.5] });
  ctx.addBox({ id:'sensor_01', type:'fixed', position:[0, 1, 2], halfExtents:[0.5, 0.5, 0.5], sensor:true, collisionEvents:true });
  ctx.addCapsule({ id:'actor_01', type:'kinematic', position:[-2, 0, 0], halfHeight:0.53, radius:0.32, translation:[0, 0.85, 0], navigationObstacle:false });
  ctx.addHingeCabinet({ id:'cabinet_01', target:-1 });
  for (let i = 0; i < 30; i += 1) ctx.step(1 / 60);
  return ctx;
}

async function runApiPhase(backendId) {
  const ctx = await createHarnessContext(backendId);
  const rows = [];
  try {
    for (const entry of PHYSICS_API_CATALOG) {
      const args = ARGUMENTS[entry.name] ?? {};
      const started = performance.now();
      const outcome = await invokePhysicsApi(ctx, entry.name, args);
      rows.push({
        tool:entry.name,
        group:entry.group,
        status:outcome.error ? 'error' : 'ok',
        elapsedMs:Number((performance.now() - started).toFixed(3)),
        error:outcome.error?.message || null
      });
    }
  } finally {
    ctx.dispose();
  }
  return rows;
}

async function runScenarioPhase(backendId, scenarios, frames = 240) {
  const rows = [];
  for (const scenario of scenarios) {
    if (scenario.browserOnly) continue;
    const backend = await createPhysicsBackend(backendId);
    const ctx = await new PhysicsScenarioContext({ scene:new THREE.Scene(), backend }).init();
    let assertions = [];
    let failure = null;
    try {
      await scenario.setup(ctx);
      for (let frame = 0; frame < frames; frame += 1) ctx.step(1 / 60);
      assertions = scenario.assertions?.(ctx, { frame:frames, time:frames / 60, fixedDt:1 / 60 }) || [];
    } catch (error) {
      failure = error?.message || String(error);
    } finally {
      ctx.dispose();
    }
    const pending = assertions.filter((item) => item.status === 'pending');
    const failed = assertions.filter((item) => item.status !== 'pending' && item.pass === false);
    rows.push({ scenario:scenario.id, backend:backendId, assertions:assertions.length, pending:pending.length, failed:failed.length, failure, failedLabels:failed.map((item) => item.label) });
  }
  return rows;
}

const label = (value) => String(value).padEnd(46);

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) { process.stdout.write(HELP); return 0; }

  const coverage = physicsApiCoverage(PhysicsSystem);
  const apiBackend = options.backend && EXECUTABLE_BACKENDS.includes(options.backend) ? options.backend : EXECUTABLE_BACKENDS[0];
  const scenarioBackends = options.backend ? [options.backend] : EXECUTABLE_BACKENDS;
  const report = { apiCoverage:{ ...coverage }, api:[], scenarios:[] };

  if (options.only === 'all' || options.only === 'api') {
    report.api = await runApiPhase(apiBackend);
  }
  if (options.only === 'all' || options.only === 'scenarios') {
    const scenarios = [...physicsScenarios, ...studioScenarios.filter((item) => !physicsScenarios.includes(item))];
    for (const backendId of scenarioBackends) {
      report.scenarios.push(...await runScenarioPhase(backendId, scenarios));
    }
  }

  if (options.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    process.stdout.write(`\n物理 API 面覆盖：${coverage.publicMethods.length} 公开方法 = 直连 ${coverage.direct.length} + 宿主 ${coverage.hostCovered.length} + 声明排除 ${coverage.excluded.length}｜缺失 ${coverage.missing.length}｜complete=${coverage.complete}\n`);
    if (report.api.length) {
      process.stdout.write(`\n【阶段 1】API 调用（backend=${apiBackend}）\n`);
      for (const row of report.api) {
        const mark = row.status === 'ok' ? '✓' : '✗';
        process.stdout.write(`  ${mark} ${label(row.tool)} ${row.elapsedMs.toFixed(2).padStart(7)} ms${row.error ? `  ${row.error}` : ''}\n`);
      }
    }
    if (report.scenarios.length) {
      process.stdout.write('\n【阶段 2】场景断言\n');
      for (const row of report.scenarios) {
        const bad = row.failure || row.failed > 0;
        const mark = bad ? '✗' : row.pending ? '…' : '✓';
        const detail = row.failure ? `异常: ${row.failure}` : row.failed ? `失败: ${row.failedLabels.join(' | ')}` : `${row.assertions} 条断言`;
        process.stdout.write(`  ${mark} ${label(row.backend + ' · ' + row.scenario)} ${detail}\n`);
      }
    }
  }

  const apiFailures = report.api.filter((row) => row.status !== 'ok').length;
  const scenarioFailures = report.scenarios.filter((row) => row.failure || row.failed > 0).length;
  const coverageFailure = coverage.complete ? 0 : 1;
  const total = apiFailures + scenarioFailures + coverageFailure;

  if (!options.json) {
    process.stdout.write(`\n结果：API 失败 ${apiFailures}｜场景失败 ${scenarioFailures}｜覆盖率 ${coverageFailure ? '不完整' : '完整'}\n\n`);
  }
  return total === 0 ? 0 : 1;
}

main().then((code) => { if (code !== 0) process.exitCode = code; }).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
