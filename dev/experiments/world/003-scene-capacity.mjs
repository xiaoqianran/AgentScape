// Run separately from tests/builds: node --expose-gc dev/experiments/world/003-scene-capacity.mjs
import os from 'node:os';
import { performance } from 'node:perf_hooks';
import { Object3D } from 'three';
import { createSession } from '../../../application/createSession.js';
import { createMonumentHall } from '../../../modules/world/content/monumentHall.js';
import { openScene } from '../../../application/scene/SceneFacade.js';

const memory = () => {
  const m = process.memoryUsage();
  return { heapMiB: m.heapUsed / 1048576, rssMiB: m.rss / 1048576, externalMiB: m.external / 1048576 };
};
const rows = [];
for (const count of [100, 1000, 10000]) {
  const session = createSession(null, { environmentFactory: () => createMonumentHall({ loadAssets: false }) });
  await session.world.init(); globalThis.gc?.();
  const before = memory(), start = performance.now();
  for (let i = 0; i < count; i++) session.world.store.add(`logical_${i}`, {
    object: new Object3D(), assetId: 'cup', manifest: { type: 'prop' }, state: { index: i }
  });
  const createMs = performance.now() - start;
  const queryStart = performance.now();
  let offset = 0, queried = 0;
  do {
    const page = session.scene.observe({ offset, limit: 100 });
    queried += page.objects.length; offset = page.nextOffset;
  } while (offset != null);
  const observeAllPagesMs = performance.now() - queryStart;
  const firstStart = performance.now(); session.scene.observe({ limit: 100 });
  const firstPageMs = performance.now() - firstStart;
  globalThis.gc?.(); const after = memory();
  session.scene.close(); session.world.dispose(); globalThis.gc?.();
  rows.push({ kind: 'logical-store-and-facade-query', count, queried, createMs, firstPageMs, observeAllPagesMs, before, after, closed: memory() });
}
// Real unmodified Runtime/history/physics. No disabled graph, history, or navigation hooks.
const count = Number(process.env.SCENE_PHYSICAL_COUNT || 100);
globalThis.gc?.(); const before = memory(), start = performance.now();
const scene = await openScene({ project: {
  schema: 'agentscape.scene-project', schemaVersion: 1, name: 'Capacity benchmark',
  environment: { type: 'builtin', id: 'monument-hall' },
  objects: Array.from({ length: count }, (_, i) => ({ id: `cup_${i}`, asset: 'builtin://cup', level: 'physical',
    transform: { position: [(i % 100) * 3, 1, Math.floor(i / 100) * 3] } }))
} });
const createMs = performance.now() - start;
const queryStart = performance.now(), page = scene.observe({ limit: Math.min(count, 1000) });
const firstPageMs = performance.now() - queryStart;
const snapshotStart = performance.now(), saved = scene.snapshot();
const snapshotMs = performance.now() - snapshotStart;
globalThis.gc?.(); const after = memory();
scene.close(); globalThis.gc?.();
rows.push({ kind: 'physical-rapier-cups', count, registeredInPage: page.objects.filter(o => o.physicsRegistered).length,
  savedObjects: saved.objects.length, createMs, firstPageMs, snapshotMs, before, after, closed: memory() });
console.log(JSON.stringify({ measuredAt: new Date().toISOString(), node: process.version,
  platform: `${os.platform()} ${os.release()} ${os.arch()}`, cpu: os.cpus()[0].model,
  logicalCpus: os.cpus().length, totalMemoryGiB: os.totalmem() / 1073741824, rows }, null, 2));
