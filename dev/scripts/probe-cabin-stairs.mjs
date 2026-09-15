// Read-only diagnostic probe: locate where the cabin cross-storey navigation breaks.
// Mirrors tests/world/magic-cabin.test.js fixtures. Does not mutate the repository.
// Run: node dev/scripts/probe-cabin-stairs.mjs
import * as THREE from 'three';
import { readFileSync } from 'node:fs';
import { createMagicCabin } from '../../modules/world/content/magicCabin.js';
import { cabinCanvasHost } from '../../tests/helpers/cabinCanvasHost.js';
import { ObjectStore } from '../../modules/world/runtime/ObjectStore.js';
import { NavigationSystem } from '../../modules/world/runtime/systems/NavigationSystem.js';
import { RecastNavigationBackend } from '../../modules/world/runtime/navigation/RecastNavigationBackend.js';
import { PhysicsSystem } from '../../modules/world/runtime/systems/PhysicsSystem.js';
import { RapierPhysicsBackend } from '../../modules/world/runtime/physics/RapierPhysicsBackend.js';

globalThis.ProgressEvent ||= class ProgressEvent { constructor(type, init = {}) { this.type = type; Object.assign(this, init); } };
globalThis.localStorage ||= { getItem:() => null, setItem() {}, removeItem() {} };

// Stair constants are read back from the generated content instead of being hardcoded here.
// A geometry change in the generator would otherwise leave the probe sampling the wrong places
// while still reporting confident numbers. Missing patterns fall back and warn.
const DEG = Math.PI / 180;
const CONTENT_URL = new URL('../../modules/world/content/magic-cabin/cabinContents.js', import.meta.url);

function readAuthoredStair() {
  const source = readFileSync(CONTENT_URL, 'utf8');
  const pick = (pattern, fallback, label) => {
    const match = source.match(pattern);
    if (!match) {
      console.warn(`probe: cannot read ${label} from cabinContents.js; using fallback ${fallback}`);
      return fallback;
    }
    return Number(match[1]);
  };
  return {
    floorTop:pick(/const HOLE_R = [\d.]+, FLOOR_TOP = ([\d.]+);/, 3.12, 'FLOOR_TOP'),
    holeRadius:pick(/const HOLE_R = ([\d.]+), FLOOR_TOP = [\d.]+;/, 1.2, 'HOLE_R'),
    railRadius:pick(/const RAIL_R = ([\d.]+),/, 1.24, 'RAIL_R'),
    stairN:pick(/const STAIR_N = (\d+);/, 14, 'STAIR_N'),
    sweepDeg:pick(/const dTheta = ([\d.]+) \/ N;/, 270, 'sweep'),
    radiusInner:pick(/const rI = ([\d.]+), rO = [\d.]+;/, 0.14, 'rI'),
    radiusOuter:pick(/const rI = [\d.]+, rO = ([\d.]+);/, 1.1, 'rO'),
    overlap:pick(/const treadHalf = dTheta \* ([\d.]+);/, 0.46, 'treadHalf factor'),
    thetaStart:pick(/const thetaEnd = (-?[\d.]+) - dTheta \/ 2;/, -60, 'thetaEnd start')
  };
}

const AUTHORED = readAuthoredStair();
const FLOOR_TOP = AUTHORED.floorTop;
const STAIR_N = AUTHORED.stairN;
const STEP_H = FLOOR_TOP / (STAIR_N + 1);
const D_THETA = AUTHORED.sweepDeg / STAIR_N;
const THETA_END = AUTHORED.thetaStart - D_THETA / 2;
const TREAD_R_I = AUTHORED.radiusInner;
const TREAD_R_O = AUTHORED.radiusOuter;
const TREAD_OVERLAP = AUTHORED.overlap;
const HOLE_R = AUTHORED.holeRadius;
const RAIL_R = AUTHORED.railRadius;
const RAIL_POST_R = TREAD_R_O - 0.07;
const MID_STEP = Math.round((STAIR_N - 1) / 2);
const UPPER_STEP = Math.min(STAIR_N - 1, Math.round((STAIR_N - 1) * 0.77));
const TOP_STEP = STAIR_N - 1;

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
  mid: tread(MID_STEP, 0.6),
  upperMid: tread(UPPER_STEP, 0.6),
  top: tread(TOP_STEP, 0.6),
  topOuter: tread(TOP_STEP, Math.max(TREAD_R_I + 0.2, TREAD_R_O - 0.15)),
  topInner: tread(TOP_STEP, TREAD_R_I + 0.21)
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
  const railNodePreviousFlags = railNodes.map((node) => ({ node, previous:node.userData.navigationIgnore }));
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
  // Restore the flags: leaving them set silently excluded the handrail from every later bake.
  for (const entry of railNodePreviousFlags) entry.node.userData.navigationIgnore = entry.previous;
  report.experiment.flagsRestored = railNodePreviousFlags.length;

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

  // Phase 5: isolate the staircase subtree and bake it alone.
  // collectStaticMeshes traverses environmentRoots only, so a single subtree is a true isolation.
  const ancestorChain = (node) => { const chain = []; for (let cur = node; cur; cur = cur.parent) chain.push(cur); return chain; };
  const deepestCommonAncestor = (nodes) => {
    if (!nodes.length) return null;
    let shared = ancestorChain(nodes[0]);
    for (const node of nodes.slice(1)) {
      const chain = new Set(ancestorChain(node));
      shared = shared.filter((candidate) => chain.has(candidate));
    }
    return shared[0] || null;
  };
  const allMeshes = [];
  cabin.root.traverse((node) => { if (node.isMesh) allMeshes.push(node); });
  const extrudeMeshes = allMeshes.filter((node) => node.geometry?.type === 'ExtrudeGeometry');
  // The 0.02-radius handrail posts exist only on the staircase, so they locate its subtree.
  const railPostMeshes = allMeshes.filter((node) => {
    const parameters = node.geometry?.parameters || {};
    return node.geometry?.type === 'CylinderGeometry'
      && Number(parameters.radiusTop) === 0.02
      && Number(parameters.radiusBottom) === 0.02;
  });
  const extrudeRoot = deepestCommonAncestor(extrudeMeshes);
  const railRoot = deepestCommonAncestor(railPostMeshes);

  // Diagnostic only: record where the staircase geometry actually sits, so the eventual
  // geometry fix knows which object to edit. This is not used for the bake below.
  report.stairSubtree = {
    totalMeshes:allMeshes.length,
    extrudeMeshes:extrudeMeshes.length,
    railPostMeshes:railPostMeshes.length,
    extrudeCommonAncestor:extrudeRoot ? { name:extrudeRoot.name || null, type:extrudeRoot.type, isCabinRoot:extrudeRoot === cabin.root, childCount:extrudeRoot.children.length } : null,
    railPostCommonAncestor:railRoot ? { name:railRoot.name || null, type:railRoot.type, isCabinRoot:railRoot === cabin.root, childCount:railRoot.children.length } : null,
    topLevelChildren:[],
    conclusion:null
  };
  const childrenWithMeshes = [];
  for (const child of cabin.root.children) {
    let meshes = 0;
    let extrudes = 0;
    child.traverse((node) => {
      if (!node.isMesh) return;
      meshes += 1;
      if (node.geometry?.type === 'ExtrudeGeometry') extrudes += 1;
    });
    if (!meshes) continue;
    const summary = {
      name:child.name || null,
      type:child.type,
      meshes,
      extrudeMeshes:extrudes,
      childCount:child.children.length
    };
    const serialized = { ...summary };
    serialized.meshes = meshes;
    serialized.extrudeMeshes = extrudes;
    report.stairSubtree.topLevelChildren.push(serialized);
    childrenWithMeshes.push({ node:child, summary });
  }
  // The staircase is the single top-level child carrying all 14 tread wedges.
  const stairGroupEntry = childrenWithMeshes
    .filter((entry) => entry.summary.extrudeMeshes >= 10)
    .sort((first, second) => second.summary.extrudeMeshes - first.summary.extrudeMeshes)[0] || null;
  report.stairSubtree.stairGroup = stairGroupEntry ? stairGroupEntry.summary : null;
  report.stairSubtree.conclusion = railRoot && railRoot !== cabin.root
    ? 'handrail posts share a separable subtree; a true isolation bake is available'
    : 'staircase geometry is not grouped under one subtree in the final scene graph';

  // Analytic feasibility of one tread versus one merged ribbon, independent of any bake.
  // The usable outer bound is min(rO, HOLE_R): beyond the opening the slab sits overhead and the
  // low clearance rejects those cells, so rO alone would overstate the tread.
  const treadHalfAngleRad = (D_THETA * TREAD_OVERLAP) * DEG;
  const TREAD_R_EFF = Math.min(TREAD_R_O, HOLE_R);
  report.treadGeometry = {
    halfAngleRad:round(treadHalfAngleRad),
    halfAngleDeg:round(treadHalfAngleRad / DEG),
    radialDepth:round(TREAD_R_O - TREAD_R_I),
    effectiveOuterRadius:round(TREAD_R_EFF),
    arcWidthAtInner:round(TREAD_R_I * 2 * treadHalfAngleRad),
    arcWidthAtMid:round(0.62 * 2 * treadHalfAngleRad),
    arcWidthAtOuter:round(TREAD_R_EFF * 2 * treadHalfAngleRad),
    requiredWalkableRadius:0.3,
    isolatedTread:maxInscribedRadius({ radiusInner:TREAD_R_I, radiusOuter:TREAD_R_EFF, halfAngleRad:treadHalfAngleRad }),
    mergedRibbon:{ maxInscribedRadius:round((TREAD_R_EFF - TREAD_R_I) / 2), note:'upper bound: ignores the angular gaps between treads' }
  };
  report.treadGeometry.isolatedTread.survivesErosion = report.treadGeometry.isolatedTread.maxInscribedRadius >= report.treadGeometry.requiredWalkableRadius;

  // Phase 5b: bake a synthetic staircase with the same dimensions but no surrounding cabin.
  // This isolates the tread geometry class itself, independently of how the cabin is assembled.
  const syntheticGroup = new THREE.Group();
  syntheticGroup.name = 'synthetic-spiral-stairs';
  for (let k = 0; k < STAIR_N; k += 1) {
    const mesh = new THREE.Mesh(syntheticTreadGeometry(synthAngleRad(k)));
    mesh.position.y = synthStepTop(k);
    syntheticGroup.add(mesh);
  }
  const synthPoint = (k, r) => {
    const a = synthAngleRad(k);
    return [round(r * Math.cos(a)), round(synthStepTop(k) - 0.03), round(r * Math.sin(a))];
  };
  const synthRuns = [
    { label:'synthetic-stairs', config:{} },
    { label:'synthetic-stairs-large-climb', config:{ maxClimb:1 } }
  ];
  report.isolation = {
    method:'synthetic staircase rebuilt from the same dimensions, baked alone',
    syntheticMeshCount:STAIR_N,
    runs:{}
  };
  for (const run of synthRuns) {
    const system = new NavigationSystem({
      store,
      environmentRoots:[syntheticGroup],
      config:run.config,
      backend:new RecastNavigationBackend()
    });
    try {
      report.isolation.runs[run.label] = {
        config:run.config,
        derived:derivedVoxels({}, run.config),
        cases:{
          'step0 -> step7':summarize(await system.findPath(synthPoint(0, 0.62), synthPoint(7, 0.62))),
          'step7 -> step13':summarize(await system.findPath(synthPoint(7, 0.62), synthPoint(13, 0.62))),
          'step0 -> step13':summarize(await system.findPath(synthPoint(0, 0.62), synthPoint(13, 0.62)))
        },
        navMesh:navMeshStats(system)
      };
    } finally {
      system.dispose();
    }
  }

  // Phase 5c: bake the real staircase group alone, using the authored treads and handrail.
  if (stairGroupEntry) {
    report.realIsolation = { group:stairGroupEntry.summary, runs:{} };
    const realRuns = [
      { label:'isolated-real-stairs', config:{} },
      { label:'isolated-real-stairs-large-climb', config:{ maxClimb:1 } }
    ];
    for (const run of realRuns) {
      const system = new NavigationSystem({
        store,
        environmentRoots:[stairGroupEntry.node],
        config:run.config,
        backend:new RecastNavigationBackend()
      });
      try {
        report.realIsolation.runs[run.label] = {
          config:run.config,
          derived:derivedVoxels({}, run.config),
          cases:{
            'stair-bottom -> stair-mid(k7)':summarize(await system.findPath(treads.bottom.point, treads.mid.point)),
            'stair-mid(k7) -> stair-top(k13)':summarize(await system.findPath(treads.mid.point, treads.top.point)),
            'stair-bottom -> stair-top(k13)':summarize(await system.findPath(treads.bottom.point, treads.top.point))
          },
          navMesh:navMeshStats(system)
        };
      } finally {
        system.dispose();
      }
    }
  }

  // Phase 5d: why does the staircase group report 30 meshes but contribute only 15 to the bake?
  if (stairGroupEntry) {
    const audit = { isMeshCount:0, visible:0, instanced:0, skinned:0, missingPositionAttribute:0, visibleNonInstancedWithPosition:0 };
    stairGroupEntry.node.traverse((child) => {
      if (!child.isMesh) return;
      audit.isMeshCount += 1;
      const hasPosition = Boolean(child.geometry?.getAttribute?.('position'));
      if (child.visible) audit.visible += 1;
      if (child.isInstancedMesh) audit.instanced += 1;
      if (child.isSkinnedMesh) audit.skinned += 1;
      if (!hasPosition) audit.missingPositionAttribute += 1;
      if (child.visible && !child.isInstancedMesh && !child.isSkinnedMesh && hasPosition) audit.visibleNonInstancedWithPosition += 1;
    });
    report.stairSubtree.groupMeshAudit = audit;
    // Ask the collector itself: the audit above says all 30 meshes are eligible, but the bake
    // only ever saw 15. Call collectStaticMeshes directly so the number and skip reasons agree.
    const probeSystem = new NavigationSystem({
      store,
      environmentRoots:[stairGroupEntry.node],
      backend:new RecastNavigationBackend()
    });
    try {
      const collected = probeSystem.collectStaticMeshes();
      report.stairSubtree.collectedByBackend = {
        meshCount:collected.meshes.length,
        skipped:collected.skipped,
        geometryTypes:collected.meshes.reduce((tally, mesh) => {
          const type = mesh.geometry?.type || 'unknown';
          tally[type] = (tally[type] || 0) + 1;
          return tally;
        }, {})
      };
    } finally {
      probeSystem.dispose();
    }
  }

  // Phase 6: which geometry change actually makes the spiral navigable?
  // Each candidate is rebuilt from scratch and baked alone, so the comparison is like for like.
  const geometryCandidates = [
    { label:'baseline-as-authored', sweepDeg:270, stairN:14, halfFactor:0.46, radiusInner:0.14, radiusOuter:1.1 },
    { label:'closed-gap-only', sweepDeg:270, stairN:14, halfFactor:0.52, radiusInner:0.14, radiusOuter:1.1 },
    { label:'wider-sweep-360', sweepDeg:360, stairN:14, halfFactor:0.52, radiusInner:0.14, radiusOuter:1.1 },
    { label:'fewer-steps-N11', sweepDeg:270, stairN:11, halfFactor:0.52, radiusInner:0.1, radiusOuter:1.25 },
    { label:'wider-radial', sweepDeg:270, stairN:14, halfFactor:0.52, radiusInner:0.08, radiusOuter:1.4 },
    { label:'combined', sweepDeg:360, stairN:11, halfFactor:0.52, radiusInner:0.08, radiusOuter:1.4 }
  ];
  report.geometrySweep = {};
  for (const spec of geometryCandidates) {
    const dThetaDeg = spec.sweepDeg / spec.stairN;
    const halfAngleDeg = spec.halfFactor * dThetaDeg;
    const halfAngleRad = halfAngleDeg * DEG;
    const riser = FLOOR_TOP / (spec.stairN + 1);
    const startDeg = -60 - dThetaDeg / 2;
    const angleAt = (step) => (startDeg - (spec.stairN - 1 - step) * dThetaDeg) * DEG;
    const midRadius = (spec.radiusInner + spec.radiusOuter) / 2;
    const pointAt = (step) => {
      const angle = angleAt(step);
      return [round(midRadius * Math.cos(angle)), round((step + 1) * riser - 0.03), round(midRadius * Math.sin(angle))];
    };

    const group = new THREE.Group();
    group.name = `synthetic-${spec.label}`;
    for (let k = 0; k < spec.stairN; k += 1) {
      const angle = angleAt(k);
      const shape = new THREE.Shape();
      shape.absarc(0, 0, spec.radiusOuter, angle - halfAngleRad, angle + halfAngleRad, false);
      shape.absarc(0, 0, spec.radiusInner, angle + halfAngleRad, angle - halfAngleRad, true);
      const wedge = new THREE.ExtrudeGeometry(shape, { depth:0.06, bevelEnabled:false });
      wedge.rotateX(Math.PI / 2);
      const mesh = new THREE.Mesh(wedge);
      mesh.position.y = (k + 1) * riser;
      group.add(mesh);
    }

    const system = new NavigationSystem({ store, environmentRoots:[group], backend:new RecastNavigationBackend() });
    try {
      const middleStep = Math.floor(spec.stairN / 2);
      report.geometrySweep[spec.label] = {
        spec,
        derived:{
          riser:round(riser),
          riserWithinClimb:riser <= 0.3,
          dThetaDeg:round(dThetaDeg),
          halfAngleDeg:round(halfAngleDeg),
          radialWidth:round(spec.radiusOuter - spec.radiusInner),
          tangentialHalfWidthAtOuter:round(spec.radiusOuter * Math.sin(halfAngleRad)),
          analyticInscribedRadius:maxInscribedRadius({ radiusInner:spec.radiusInner, radiusOuter:spec.radiusOuter, halfAngleRad }).maxInscribedRadius
        },
        cases:{
          'lowest -> middle':summarize(await system.findPath(pointAt(0), pointAt(middleStep))),
          'middle -> highest':summarize(await system.findPath(pointAt(middleStep), pointAt(spec.stairN - 1))),
          'lowest -> highest':summarize(await system.findPath(pointAt(0), pointAt(spec.stairN - 1)))
        },
        navMesh:navMeshStats(system)
      };
    } finally {
      system.dispose();
    }
  }

  // Phase 6b: localise the first broken riser. One query per adjacent pair, so the break point is
  // read off directly instead of inferred from a long path.
  report.consecutive = { unit:'tread(k) -> tread(k+1)', rows:[] };
  for (let k = 0; k < STAIR_N - 1; k += 1) {
    const result = await navigation.findPath(tread(k, 0.62).point, tread(k + 1, 0.62).point);
    report.consecutive.rows.push({
      pair:`${k}->${k + 1}`,
      fromAngle:round(tread(k, 0.62).angleDeg),
      fromY:round(tread(k, 0.62).yTop),
      reachable:result.reachable,
      reason:result.reason ?? null,
      waypoints:result.path ? result.path.length : 0,
      startSnap:round(result.start?.snapDistance),
      endSnap:round(result.end?.snapDistance)
    });
  }
  report.consecutive.brokenPairs = report.consecutive.rows.filter((row) => !row.reachable).map((row) => row.pair);
  report.consecutive.firstBroken = report.consecutive.brokenPairs[0] || null;

  // Phase 7: validate the fix in situ. Rebuild the staircase inside the real cabin and bake the whole
  // cabin again, so the test includes the walls, the upper-floor slab and the opening.
  // The spec keeps radiusOuter at 1.10 so the slab opening (HOLE_R) still clears, and satisfies
  // radiusOuter * sin(halfAngle) >= agentRadius. Only stairN, the sweep and the tread overlap change.
  {
    const spec = { stairN:11, sweepDeg:360, overlapFactor:0.52, radiusInner:TREAD_R_I, radiusOuter:TREAD_R_O, railHeight:0.85, thickness:0.06 };
    const dThetaDeg = spec.sweepDeg / spec.stairN;
    const halfAngleRad = spec.overlapFactor * dThetaDeg * DEG;
    const riser = FLOOR_TOP / (spec.stairN + 1);
    const startDeg = -60 - dThetaDeg / 2;
    const postRadius = spec.radiusOuter - 0.07;
    const angleAt = (step) => (startDeg - (spec.stairN - 1 - step) * dThetaDeg) * DEG;
    const pointOnTread = (step, radius = 0.62) => {
      const th = angleAt(step);
      return [round(radius * Math.sin(th)), round((step + 1) * riser - 0.03), round(radius * Math.cos(th))];
    };

    // Same construction as the migrated buildStairs(), with the constants lifted into the spec.
    const treadGeometry = (a0, a1) => {
      const shape = new THREE.Shape();
      shape.moveTo(spec.radiusInner * Math.sin(a0), spec.radiusInner * Math.cos(a0));
      shape.lineTo(spec.radiusOuter * Math.sin(a0), spec.radiusOuter * Math.cos(a0));
      const segments = 5;
      for (let j = 1; j <= segments; j += 1) {
        const a = a0 + (a1 - a0) * j / segments;
        shape.lineTo(spec.radiusOuter * Math.sin(a), spec.radiusOuter * Math.cos(a));
      }
      shape.lineTo(spec.radiusInner * Math.sin(a1), spec.radiusInner * Math.cos(a1));
      shape.closePath();
      const geometry = new THREE.ExtrudeGeometry(shape, { depth:spec.thickness, bevelEnabled:false });
      geometry.rotateX(Math.PI / 2);
      geometry.translate(0, spec.thickness, 0);
      return geometry;
    };

    const rebuilt = new THREE.Group();
    rebuilt.name = 'rebuilt-stairs';
    const railPoints = [];
    for (let k = 0; k < spec.stairN; k += 1) {
      const th = angleAt(k);
      const thDeg = startDeg - (spec.stairN - 1 - k) * dThetaDeg;
      const yTop = (k + 1) * riser;
      const tread = new THREE.Mesh(treadGeometry(th - halfAngleRad, th + halfAngleRad));
      tread.position.y = yTop - spec.thickness;
      rebuilt.add(tread);
      const norm = ((thDeg % 360) + 360) % 360;
      const underPlatform = (norm <= 60 || norm >= 300) && (yTop + spec.railHeight > FLOOR_TOP - 0.1);
      if (!underPlatform) {
        const post = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, spec.railHeight, 6));
        post.position.set(postRadius * Math.sin(th), yTop + spec.railHeight / 2, postRadius * Math.cos(th));
        rebuilt.add(post);
        railPoints.push(new THREE.Vector3(postRadius * Math.sin(th), yTop + spec.railHeight, postRadius * Math.cos(th)));
      }
    }
    const newel = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, FLOOR_TOP + spec.railHeight, 12));
    newel.position.set(0, (FLOOR_TOP + spec.railHeight) / 2, 0);
    rebuilt.add(newel);
    if (railPoints.length > 1) {
      rebuilt.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(railPoints), 64, 0.03, 6, false)));
    }

    const stairParent = stairGroupEntry ? stairGroupEntry.node.parent : null;
    if (stairParent) {
      stairParent.remove(stairGroupEntry.node);
      stairParent.add(rebuilt);
    }

    const system = new NavigationSystem({ store, environmentRoots:[cabin.root], backend:new RecastNavigationBackend() });
    try {
      const middleStep = Math.floor(spec.stairN / 2);
      report.rebuiltInCabin = {
        spec,
        replacementApplied:Boolean(stairParent),
        derived:{
          riser:round(riser),
          riserWithinClimb:riser <= 0.3,
          dThetaDeg:round(dThetaDeg),
          halfAngleDeg:round(halfAngleRad / DEG),
          tangentialHalfWidthAtOuter:round(spec.radiusOuter * Math.sin(halfAngleRad)),
          analyticInscribedRadius:maxInscribedRadius({ radiusInner:spec.radiusInner, radiusOuter:spec.radiusOuter, halfAngleRad }).maxInscribedRadius,
          slabOpeningRadius:HOLE_R,
          radialClearance:round(HOLE_R - spec.radiusOuter)
        },
        baselineCrossFloor:report.cases['1F-inside -> 2F'],
        baselineHistogram:report.navMesh.yHistogram,
        cases:{
          'outside -> 1F-inside':summarize(await system.findPath([0, 0, 6], inside)),
          '1F-inside -> 2F':summarize(await system.findPath(inside, upper)),
          '2F -> 1F-inside':summarize(await system.findPath(upper, inside)),
          '1F-inside -> stair-mid(k5)':summarize(await system.findPath(inside, pointOnTread(middleStep))),
          'stair-mid(k5) -> stair-top(k10)':summarize(await system.findPath(pointOnTread(middleStep), pointOnTread(spec.stairN - 1))),
          '1F-inside -> stair-top(k10)':summarize(await system.findPath(inside, pointOnTread(spec.stairN - 1)))
        },
        navMesh:navMeshStats(system)
      };
      report.rebuiltInCabin.midHeightsPresent = ['1.00', '1.25', '1.50', '1.75', '2.00', '2.25', '2.50']
        .reduce((tally, key) => { tally[key] = report.rebuiltInCabin.navMesh.yHistogram[key] || 0; return tally; }, {});
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

// The synthetic staircase reproduces the authored spiral dimensions without the cabin around it.
// After rotateX(PI/2) a shape point (x,y) lands at world (x, 0, y), so the query points below
// use x = r*cos(angle), z = r*sin(angle).
function synthAngleRad(step) {
  return (THETA_END - (STAIR_N - 1 - step) * D_THETA) * DEG;
}

function synthStepTop(step) {
  return (step + 1) * STEP_H;
}

function syntheticTreadGeometry(angleCenterRad) {
  const half = (D_THETA * TREAD_OVERLAP) * DEG;
  const shape = new THREE.Shape();
  shape.absarc(0, 0, TREAD_R_O, angleCenterRad - half, angleCenterRad + half, false);
  shape.absarc(0, 0, TREAD_R_I, angleCenterRad + half, angleCenterRad - half, true);
  const geometry = new THREE.ExtrudeGeometry(shape, { depth:0.06, bevelEnabled:false });
  geometry.rotateX(Math.PI / 2);
  return geometry;
}

// Largest circle that fits inside one wedge-shaped tread, sampled on a polar grid.
// Boundary distance is measured against the inner arc, the outer arc and the two radial edges.
function maxInscribedRadius({ radiusInner, radiusOuter, halfAngleRad, stepRadius = 0.005, stepAngle = 0.002 }) {
  let best = 0;
  let at = null;
  for (let r = radiusInner; r <= radiusOuter + 1e-9; r += stepRadius) {
    for (let offset = -halfAngleRad; offset <= halfAngleRad + 1e-9; offset += stepAngle) {
      const toEdge = r * Math.sin(halfAngleRad - Math.abs(offset));
      const limit = Math.min(r - radiusInner, radiusOuter - r, toEdge);
      if (limit > best) {
        best = limit;
        at = { radius:round(r), angleOffsetDeg:round(offset / DEG) };
      }
    }
  }
  return { maxInscribedRadius:round(best), at };
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
