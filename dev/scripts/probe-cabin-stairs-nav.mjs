import { createMagicCabin } from '../../modules/world/content/magicCabin.js';
import { cabinCanvasHost } from '../../tests/helpers/cabinCanvasHost.js';
import { createRecastNavigationSystem } from '../../tests/helpers/createRecastNavigationSystem.js';
import { ObjectStore } from '../../modules/world/runtime/ObjectStore.js';

const cabin = createMagicCabin(cabinCanvasHost());
const stairRoots = [];
cabin.root.traverse((node) => {
  if (node.isMesh && node.userData.navigationIgnore === false) stairRoots.push(node);
});
console.log('nav-visible architecture meshes', stairRoots.length);

// Find stair treads by y range
const treadLike = [];
cabin.root.traverse((node) => {
  if (!node.isMesh) return;
  node.updateWorldMatrix(true, false);
  const e = node.matrixWorld.elements;
  const y = e[13];
  if (y > 0.05 && y < 3.2 && node.geometry?.type?.includes('Extrude')) {
    treadLike.push({ name: node.name, type: node.geometry.type, y: Number(y.toFixed(3)), navIgnore: node.userData.navigationIgnore, pos: [e[12], e[13], e[14]].map(v => Number(v.toFixed(3))) });
  }
});
console.log('extrude meshes in stair height', treadLike.slice(0, 20), 'count', treadLike.length);

const navigationConfigs = [
  { label: 'default', config: {} },
  { label: 'cabin-nav', config: cabin.navigation || {} },
  { label: 'tiny-agent', config: { maxClimb: 0.8, agentRadius: 0.12, agentHeight: 1.6, maxSlope: 60, endTolerance: 0.4 } },
  { label: 'coarse-cell', config: { maxClimb: 0.8, agentRadius: 0.2, agentHeight: 1.7, cellSize: 0.1, cellHeight: 0.08 } }
];

const door = cabin.interactions.find(i => i.contractId === 'cabin:front-door');
door.activate();
for (let i = 0; i < 200; i++) cabin.step(1 / 60);

for (const { label, config } of navigationConfigs) {
  const tuning = {};
  if (config.cellSize) tuning.cellSize = config.cellSize;
  if (config.cellHeight) tuning.cellHeight = config.cellHeight;
  const navigation = createRecastNavigationSystem({
    store: new ObjectStore(),
    environmentRoots: [cabin.root],
    backendOptions: tuning,
    ...config
  });
  try {
    const from = [0, 0, 6];
    const upstairs = [-2, 3.12, 0];
    const midStair = [1.2, 1.55, -1.2];
    const r1 = await navigation.findPath(from, upstairs, { maxSnapDistance: 1.2 });
    const r2 = await navigation.findPath(from, midStair, { maxSnapDistance: 1.2 });
    const r3 = await navigation.findPath(from, [0, 0, 0], { maxSnapDistance: 1.2 });
    const mesh = navigation.backend.debugMesh?.() || { positions: [] };
    let upstairsVerts = 0;
    for (let i = 1; i < mesh.positions.length; i += 3) {
      const y = mesh.positions[i];
      if (y > 2.5 && y < 3.5) upstairsVerts++;
      if (y > 0.3 && y < 2.8) upstairsVerts += 0; // count only floor2
    }
    let midY = 0;
    for (let i = 1; i < mesh.positions.length; i += 3) {
      const y = mesh.positions[i];
      if (y > 0.2 && y < 3.0) midY++;
    }
    console.log(label, {
      indoor: r3.reachable, r3: r3.reason,
      midStair: r2.reachable, r2: r2.reason,
      upstairs: r1.reachable, r1: r1.reason,
      end: r1.end?.snapped,
      navVertCount: mesh.positions.length / 3,
      vertsY2_5to3_5: upstairsVerts,
      vertsY0_2to3: midY,
      build: navigation.lastBuild
    });
  } finally {
    navigation.dispose();
  }
}

cabin.dispose();
