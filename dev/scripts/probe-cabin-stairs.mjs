// Read-only diagnostic probe: locate where the cabin cross-storey navigation breaks.
// Mirrors tests/world/magic-cabin.test.js fixtures. Does not mutate the repository.
// Run: node dev/scripts/probe-cabin-stairs.mjs
import { createMagicCabin } from '../../modules/world/content/magicCabin.js';
import { cabinCanvasHost } from '../../tests/helpers/cabinCanvasHost.js';
import { ObjectStore } from '../../modules/world/runtime/ObjectStore.js';
import { NavigationSystem } from '../../modules/world/runtime/systems/NavigationSystem.js';
import { RecastNavigationBackend } from '../../modules/world/runtime/navigation/RecastNavigationBackend.js';
import { PhysicsSystem } from '../../modules/world/runtime/systems/PhysicsSystem.js';
import { RapierPhysicsBackend } from '../../modules/world/runtime/physics/RapierPhysicsBackend.js';

globalThis.ProgressEvent ||= class ProgressEvent { constructor(type, init = {}) { this.type = type; Object.assign(this, init); } };
globalThis.localStorage ||= { getItem:() => null, setItem() {}, removeItem() {} };

// Stair geometry constants as authored in the migrated content.
const DEG = Math.PI / 180;
const FLOOR_TOP = 3.12;
const STAIR_N = 14;
const STEP_H = FLOOR_TOP / (STAIR_N + 1);
const D_THETA = 270 / STAIR_N;
const THETA_END = -60 - D_THETA / 2;
const TREAD_R_I = 0.14;
const TREAD_R_O = 1.1;
const HOLE_R = 1.2;
const RAIL_R = 1.24;
const RAIL_POST_R = TREAD_R_O - 0.07;

const round = (value) => (Number.isFinite(value) ? Number(Number(value).toFixed(3)) : value);

function tread(stepIndex, radius) {
  const angleDeg = THETA_END - (STAIR_N - 1 - stepIndex) * D_THETA;
  const th = angleDeg * DEG;
  const yTop = (stepIndex + 1) * STEP_H;
  return {
    step: stepIndex,
    angleDeg: round(angleDeg),
    yTop: round(yTop),
    yCenterHint: round(yTop - 0.03),
    point: [radius * Math.sin(th), round(yTop - 0.03), radius * Math.cos(th)]
  };
}

const treads = {
  bottom: tread(0, 0.6),
  mid: tread(7, 0.6),
  upperMid: tread(10, 0.6),
  top: tread(13, 0.6),
  topOuter: tread(13, 0.95),
  topInner: tread(13, 0.35)
};

const inside = [2, 0, -2];
const upper = [-2, FLOOR_TOP, 0];

const cabin = createMagicCabin(cabinCanvasHost());
const store = new ObjectStore();
const navigation = new NavigationSystem({
  store,
  environmentRoots:[cabin.root],
  backend:new RecastNavigationBackend()
});

const report = {
  schema:'agentscape.cabin-stair-probe',
  schemaVersion:1,
  mode:'offline-deterministic-readonly',
  inputs:{
    floorTop:FLOOR_TOP,
    stairN:STAIR_N,
    stepHeight:round(STEP_H),
    holeRadius:HOLE_R,
    railRingRadius:RAIL_R,
    railPostRadius:RAIL_POST_R,
    treadRadiusInner:TREAD_R_I,
    treadRadiusOuter:TREAD_R_O,
    deltaThetaDeg:round(D_THETA),
    railPostSpacingAtRing:round(RAIL_POST_R * D_THETA * DEG)
  },
  treads,
  environment:{},
  cases:{},
  navMesh:{}
};

try {
  report.environment.colliders = cabin.colliders.length;
  report.environment.interactions = cabin.interactions.length;
  report.environment.affordances = cabin.affordances.length;
  report.environment.diagnostics = cabin.diagnostics();

  // Closed door must block the interior, matching the existing test expectation.
  const closedEntry = await navigation.findPath([0, 0, 6], inside);
  report.cases['outside -> 1F-inside (door closed)'] = summarize(closedEntry);

  const door = cabin.interactions.find((item) => item.label.includes('大门'));
  if (door) door.activate();
  for (let i = 0; i < 180; i += 1) cabin.step(1 / 60);
  navigation.invalidate('probe-door-opened');

  const openEntry = await navigation.findPath([0, 0, 6], inside);
  report.cases['outside -> 1F-inside (door open)'] = summarize(openEntry);
  report.cases['1F-inside -> 2F'] = summarize(await navigation.findPath(inside, upper));
  report.cases['2F -> 1F-inside'] = summarize(await navigation.findPath(upper, inside));
  report.cases['1F-inside -> stair-bottom'] = summarize(await navigation.findPath(inside, treads.bottom.point));
  report.cases['1F-inside -> stair-mid(k7)'] = summarize(await navigation.findPath(inside, treads.mid.point));
  report.cases['1F-inside -> stair-upperMid(k10)'] = summarize(await navigation.findPath(inside, treads.upperMid.point));
  report.cases['1F-inside -> stair-top(k13)'] = summarize(await navigation.findPath(inside, treads.top.point));
  report.cases['stair-bottom -> stair-mid(k7)'] = summarize(await navigation.findPath(treads.bottom.point, treads.mid.point));
  report.cases['stair-mid(k7) -> stair-top(k13)'] = summarize(await navigation.findPath(treads.mid.point, treads.top.point));
  report.cases['stair-top(k13) -> 2F'] = summarize(await navigation.findPath(treads.top.point, upper));
  report.cases['stair-topOuter(r.95) -> 2F'] = summarize(await navigation.findPath(treads.topOuter.point, upper));
  report.cases['stair-topInner(r.35) -> 2F'] = summarize(await navigation.findPath(treads.topInner.point, upper));
  report.cases['2F -> stair-top(k13)'] = summarize(await navigation.findPath(upper, treads.top.point));

  report.navMesh = navMeshStats(navigation);

  // A/B experiment: exclude the handrail (rail posts + banister tube) from navigation
  // input and re-bake, to decide whether the handrail is what removes the mid-storey ribbon.
  const railNodes = [];
  cabin.root.traverse((node) => {
    if (!node.isMesh) return;
    const type = node.geometry?.type;
    const parameters = node.geometry?.parameters || {};
    const isBanisterTube = type === 'TubeGeometry';
    const isRailPost = type === 'CylinderGeometry'
      && Number(parameters.radiusTop) === 0.02
      && Number(parameters.radiusBottom) === 0.02;
    if (isBanisterTube || isRailPost) railNodes.push(node);
  });
  report.experiment = {
    question:'does the handrail remove the mid-storey stair ribbon from the navmesh?',
    excluded:{
      total:railNodes.length,
      banisterTubes:railNodes.filter((node) => node.geometry.type === 'TubeGeometry').length,
      railPosts:railNodes.filter((node) => node.geometry.type === 'CylinderGeometry').length
    },
    before:report.navMesh.stairFootprint,
    beforeCases:{
      '1F-inside -> stair-mid(k7)':report.cases['1F-inside -> stair-mid(k7)'],
      '1F-inside -> 2F':report.cases['1F-inside -> 2F']
    }
  };
  for (const node of railNodes) node.userData.navigationIgnore = true;
  navigation.invalidate('probe-rail-excluded');
  report.experiment.afterCases = {
    '1F-inside -> stair-mid(k7)':summarize(await navigation.findPath(inside, treads.mid.point)),
    'stair-mid(k7) -> stair-top(k13)':summarize(await navigation.findPath(treads.mid.point, treads.top.point)),
    '1F-inside -> stair-top(k13)':summarize(await navigation.findPath(inside, treads.top.point)),
    '1F-inside -> 2F':summarize(await navigation.findPath(inside, upper)),
    '2F -> 1F-inside':summarize(await navigation.findPath(upper, inside))
  };
  report.experiment.after = navMeshStats(navigation);

  // Phase 3: physical clearance above every tread, measured with Rapier rather than inferred.
  report.derived = { baseline:derivedVoxels({}, {}) };
  const physics = new PhysicsSystem({ backend:new RapierPhysicsBackend() });
  await physics.init();
  try {
    physics.addEnvironment(cabin.colliders, { id:cabin.id });
    const probeRadii = [0.35, 0.6, 0.9];
    report.clearance = {
      method:'rapier-vertical-raycast',
      castOriginAboveTread:0.05,
      castLength:4,
      requiredClearance:1.7,
      byTread:[]
    };
    for (let k = 0; k < STAIR_N; k += 1) {
      const base = tread(k, 0.6);
      const normDeg = ((base.angleDeg % 360) + 360) % 360;
      const entry = {
        step:k,
        angleDeg:base.angleDeg,
        normDeg:round(normDeg),
        yTop:base.yTop,
        inCoveredSector:(normDeg <= 60 || normDeg >= 300),
        clearances:{}
      };
      for (const r of probeRadii) {
        const th = base.angleDeg * DEG;
        const x = r * Math.sin(th);
        const z = r * Math.cos(th);
        const hit = physics.raycast([x, base.yTop + 0.05, z], [x, base.yTop + 0.05 + 4, z]);
        entry.clearances[`r${r}`] = hit
          ? {
            clearance:round(0.05 + hit.distance),
            meets1_7:0.05 + hit.distance >= 1.7,
            owner:hit.id ?? null,
            part:hit.part ?? null,
            environment:hit.environment ?? null,
            environmentId:hit.provenance?.environmentId ?? null,
            point:Array.isArray(hit.point) ? hit.point.map(round) : null
          }
          : { clearance:null, meets1_7:true, note:'no solid within 4 m' };
      }
      report.clearance.byTread.push(entry);
    }
  } finally {
    physics.dispose();
  }

  // Phase 4: does the bake tuning decide whether the mid-storey ribbon exists at all?
  const variants = [
    { label:'finer-voxels', backend:{ cellSize:0.08, cellHeight:0.05 }, config:{} },
    { label:'smaller-agent-radius', backend:{}, config:{ agentRadius:0.15 } },
    { label:'large-climb', backend:{}, config:{ maxClimb:1 } }
  ];
  report.tuningVariants = {};
  for (const variant of variants) {
    const system = new NavigationSystem({
      store,
      environmentRoots:[cabin.root],
      config:variant.config,
      backend:new RecastNavigationBackend(variant.backend)
    });
    try {
      report.tuningVariants[variant.label] = {
        backendTuning:variant.backend,
        config:variant.config,
        derived:derivedVoxels(variant.backend, variant.config),
        cases:{
          '1F-inside -> 2F':summarize(await system.findPath(inside, upper)),
          '1F-inside -> stair-mid(k7)':summarize(await system.findPath(inside, treads.mid.point)),
          'stair-mid(k7) -> stair-top(k13)':summarize(await system.findPath(treads.mid.point, treads.top.point)),
          'stair-top(k13) -> 2F':summarize(await system.findPath(treads.top.point, upper)),
          '2F -> 1F-inside':summarize(await system.findPath(upper, inside))
        },
        navMesh:navMeshStats(system)
      };
    } finally {
      system.dispose();
    }
  }

  report.status = 'completed';
} catch (error) {
  report.status = 'failed';
  report.error = { name:error.name, message:error.message, stack:(error.stack || '').split('\n').slice(0, 6) };
} finally {
  navigation.dispose();
  cabin.dispose();
}

// Mirrors RecastNavigationBackend.recastConfig so a variant can be read as voxel counts.
function derivedVoxels(tuning, config) {
  const cellSize = tuning.cellSize ?? 0.15;
  const cellHeight = tuning.cellHeight ?? 0.1;
  const agentRadius = config.agentRadius ?? 0.3;
  const agentHeight = config.agentHeight ?? 1.7;
  const maxClimb = config.maxClimb ?? 0.3;
  const ceil = (value, cell) => Math.ceil(value / cell - 1e-9);
  const floor = (value, cell) => Math.floor(value / cell + 1e-9);
  return {
    cellSize,
    cellHeight,
    agentRadius,
    agentHeight,
    maxClimb,
    walkableRadiusCells:Math.max(0, ceil(agentRadius, cellSize)),
    walkableRadiusMetres:round(Math.max(0, ceil(agentRadius, cellSize)) * cellSize),
    walkableHeightCells:Math.max(3, ceil(agentHeight, cellHeight)),
    walkableClimbCells:Math.max(0, floor(maxClimb, cellHeight))
  };
}

function navMeshStats(navigation) {
  const snapshot = navigation.debugSnapshot();
  const positions = snapshot.navMesh.positions;
  const indices = snapshot.navMesh.indices;
  const yHistogram = {};
  const stairFootprint = { radiusFilter:1.6, triangles:0, minY:null, maxY:null, byY:{} };
  const triangles = Math.floor(indices.length / 3);
  for (let t = 0; t < triangles; t += 1) {
    const a = indices[t * 3] * 3;
    const b = indices[t * 3 + 1] * 3;
    const c = indices[t * 3 + 2] * 3;
    const cx = (positions[a] + positions[b] + positions[c]) / 3;
    const cy = (positions[a + 1] + positions[b + 1] + positions[c + 1]) / 3;
    const cz = (positions[a + 2] + positions[b + 2] + positions[c + 2]) / 3;
    const bucket = (Math.round(cy * 4) / 4).toFixed(2);
    yHistogram[bucket] = (yHistogram[bucket] || 0) + 1;
    if (Math.hypot(cx, cz) <= stairFootprint.radiusFilter) {
      stairFootprint.triangles += 1;
      stairFootprint.byY[bucket] = (stairFootprint.byY[bucket] || 0) + 1;
      stairFootprint.minY = stairFootprint.minY === null ? round(cy) : Math.min(stairFootprint.minY, round(cy));
      stairFootprint.maxY = stairFootprint.maxY === null ? round(cy) : Math.max(stairFootprint.maxY, round(cy));
    }
  }
  const status = navigation.status();
  return {
    buildVersion:status.buildVersion ?? null,
    lastBuild:status.lastBuild ?? null,
    triangles:snapshot.navMesh.triangleCount,
    vertices:snapshot.navMesh.vertexCount,
    trianglesScanned:triangles,
    yHistogram,
    stairFootprint
  };
}

function summarize(result) {
  return {
    reachable: result.reachable,
    scope: result.scope ?? null,
    reason: result.reason ?? null,
    sameIsland: result.sameIsland ?? null,
    cost: round(result.cost),
    waypoints: result.path ? result.path.length : 0,
    startSnap: round(result.start?.snapDistance),
    endSnap: round(result.end?.snapDistance),
    startSnapped: result.start?.snapped ?? null,
    endSnapped: result.end?.snapped ?? null,
    finalDistance: round(result.finalDistance),
    snapDistance: round(result.snapDistance),
    snapped: result.snapped ?? null,
    buildVersion: result.buildVersion ?? null
  };
}

console.log(JSON.stringify(report, null, 2));
