// Diagnostic for the open item from 004: magic-cabin / coffee-corner reported
// navToCabinet.reachable === false with agentTravel === 0.
//
// Determines whether inside<->outside reachability is gated by the front-door state, and whether
// the composer's auto-placed agent spawn lands in a different navigable component than an outdoor
// target.
//
// Read-only. Run with:
//   node dev/experiments/world/005-cabin-door-reachability.mjs
import * as THREE from 'three';

import { createMagicCabin } from '../../../modules/world/content/magicCabin.js';
import { ObjectStore } from '../../../modules/world/runtime/ObjectStore.js';
import { PhysicsSystem } from '../../../modules/world/runtime/systems/PhysicsSystem.js';
import { RapierPhysicsBackend } from '../../../modules/physics/RapierPhysicsBackend.js';
import { NavigationSystem } from '../../../modules/world/runtime/systems/NavigationSystem.js';
import { RecastNavigationBackend } from '../../../modules/navigation/RecastNavigationBackend.js';
import { disposeObject3D } from '../../../modules/rendering/disposeObject3D.js';
import { cabinCanvasHost } from '../../../tests/helpers/cabinCanvasHost.js';

globalThis.ProgressEvent ||= class ProgressEvent { constructor(type, init = {}) { this.type = type; Object.assign(this, init); } };
globalThis.localStorage ||= { getItem: () => null, setItem() {}, removeItem() {} };

const round = (v, d = 3) => (Number.isFinite(v) ? Number(Number(v).toFixed(d)) : v);

// Every position that appeared in 004, plus explicit inside/outside references derived from
// tests/world/magic-cabin.test.js assertions.
const POINTS = [
  { label: 'agent-declared', p: [6, 0, -5] },
  { label: 'agent-auto-coffee', p: [-0.5, 0, 0] },
  { label: 'agent-auto-placed', p: [-0.5, 0, 0] },
  { label: 'outside-z6', p: [0, 0, 6] },
  { label: 'inside-z2', p: [0, 0, 2] },
  { label: 'cabinet-outdoor', p: [7, 0, 5] },
  { label: 'table-outdoor', p: [7, 0, 2] },
  { label: 'upper-floor', p: [-2, 3.12, 0] }
];

const cabin = createMagicCabin(cabinCanvasHost());
const store = new ObjectStore();
const physics = new PhysicsSystem({ backend: new RapierPhysicsBackend() });
await physics.init();
physics.addEnvironment(cabin.colliders, { id: cabin.id });
const navigation = new NavigationSystem({
  store, physics, environmentRoots: [cabin.root], backend: new RecastNavigationBackend()
});

const frontDoor = cabin.interactions.find((item) => item.label.includes('大门'));
const doorRotation = () => (frontDoor && frontDoor.object ? round(frontDoor.object.rotation.y, 4) : null);
const doorOpenState = () => (frontDoor && frontDoor.object ? frontDoor.object.userData.state || null : null);

async function matrix(label) {
  const rows = [];
  for (const from of POINTS) {
    for (const to of POINTS) {
      if (from.label === to.label) continue;
      let result;
      try {
        const path = await navigation.findPath(from.p, to.p);
        result = { reachable: path.reachable, points: path.path ? path.path.length : 0, cost: round(path.cost) };
      } catch (error) {
        result = { error: String(error && error.message ? error.message : error).slice(0, 120) };
      }
      rows.push({ from: from.label, to: to.label, ...result });
    }
  }
  return { label, doorRotation: doorRotation(), doorState: doorOpenState(), build: navigation.status().lastBuild || null, rows };
}

async function advance(frames) {
  for (let i = 0; i < frames; i += 1) {
    cabin.step(1 / 60, { physics, navigation });
    physics.step(1 / 60, store);
    if (i % 20 === 0) await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

const report = { schema: 'agentscape.cabin-door-reachability', schemaVersion: 1, points: POINTS };

try {
  await advance(30);
  report.closed = await matrix('front-door-closed');
  console.log('--- CLOSED ---');
  console.log(JSON.stringify({ doorRotation: report.closed.doorRotation, doorState: report.closed.doorState, build: report.closed.build }));

  if (!frontDoor) throw new Error('front door interaction not found; cannot toggle door state');
  frontDoor.activate();
  await advance(180);
  navigation.invalidate('door-opened');
  report.opened = await matrix('front-door-opened');
  console.log('--- OPENED ---');
  console.log(JSON.stringify({ doorRotation: report.opened.doorRotation, doorState: report.opened.doorState, build: report.opened.build }));

  const key = (side, from, to) => {
    const row = (side.rows || []).find((entry) => entry.from === from && entry.to === to);
    return row ? row.reachable : null;
  };
  const comparisons = [
    ['inside->outside (z2 -> z6)', 'inside-z2', 'outside-z6'],
    ['inside-center -> outdoor cabinet', 'agent-auto-coffee', 'cabinet-outdoor'],
    ['declared agent -> outdoor cabinet', 'agent-declared', 'cabinet-outdoor'],
    ['outside -> outdoor cabinet', 'outside-z6', 'cabinet-outdoor'],
    ['declared agent -> outdoor table', 'agent-declared', 'table-outdoor'],
    ['inside-center -> outdoor table', 'agent-auto-coffee', 'table-outdoor'],
    ['inside-center -> z2', 'agent-auto-coffee', 'inside-z2'],
    ['declared agent -> upstairs', 'agent-declared', 'upper-floor']
  ];
  report.comparison = comparisons.map(([label, from, to]) => ({
    label, from, to,
    closed: key(report.closed, from, to),
    opened: key(report.opened, from, to)
  }));
  console.log('=== COMPARISON ===');
  console.table(report.comparison);
} finally {
  try { navigation.dispose(); } catch {}
  try { physics.dispose(); } catch {}
  try { cabin.dispose(); } catch {}
  try { disposeObject3D(cabin.root); } catch {}
}

const { writeFile } = await import('node:fs/promises');
await writeFile(new URL('./005-results.json', import.meta.url), JSON.stringify(report, null, 2));
console.log('wrote 005-results.json');
process.exit(0);
