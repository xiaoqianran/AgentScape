import { describe, expect, it } from 'vitest';
import { createSession } from '../../application/createSession.js';
import { createSuzhouGardenEnvironment, SUZHOU_ENTRANCE_STRUCTURES } from '../../modules/world/content/suzhouGarden/index.js';
import { createAssetModule } from '../../modules/asset/AssetModule.js';
import { createHeadlessGLTFLoader } from '../../apps/mcp-server/HeadlessGLTFLoader.js';
import { installHeadlessAssetIO } from '../../apps/mcp-server/HeadlessAssetIO.js';

// CONTENT-015: the entrance-axis region (澄观门庭, Z 110 -> 40) of the Suzhou
// garden carries real building collision, navmesh blocking and interactive
// objects; the rest of the garden remains display-only (terrain only).
const inBox = (p, cx, cz, hx, hz) => Math.abs(p[0] - cx) < hx && Math.abs(p[2] - cz) < hz;

async function gardenSession() {
  installHeadlessAssetIO();
  const session = createSession(null, {
    assetModule: createAssetModule({ gltfLoader: createHeadlessGLTFLoader() }),
    environmentFactory: () => createSuzhouGardenEnvironment()
  });
  await session.world.init();
  return session;
}

async function driveJob(scene, world, job) {
  let done = false, result, error;
  const promise = scene.waitJob(job.id);
  promise.then((value) => { done = true; result = value; }, (cause) => { done = true; error = cause; });
  for (let frame = 0; frame < 12000 && !done; frame++) {
    world.stepSimulation(1 / 60);
    world.sceneGraph.update();
    if (frame % 12 === 0) await new Promise((resolve) => setTimeout(resolve, 0));
    else await Promise.resolve();
  }
  if (error) throw error;
  if (!done) throw new Error(`frame budget exceeded for ${job.id}`);
  return result;
}

describe('suzhou garden entrance region (CONTENT-015)', () => {
  it('gives the entrance structures physics colliders that block poses but leave the gate doorway open', async () => {
    const session = await gardenSession();
    const world = session.world;
    try {
      expect(SUZHOU_ENTRANCE_STRUCTURES.length).toBeGreaterThanOrEqual(8);
      expect(world.environment.colliders.length).toBe(1 + SUZHOU_ENTRANCE_STRUCTURES.length);
      const probe = { physics: { body: 'fixed', colliders: [{ shape: 'box', halfExtents: [.3, .5, .3], translation: [0, 2, 0] }] } };
      const blocked = [['gate-west', [-4.4, 0, 92]], ['gate-east', [4.4, 0, 92]], ['sedan-hall', [0, 0, 80]], ['chengguan-hall', [0, 0, 58]], ['shadow-wall-mid', [-11.5, 0, 106.5]], ['shadow-wall-end', [-13.6, 0, 107.8]]];
      for (const [, pos] of blocked) expect(world.physics.checkManifestPose(probe, pos).clear).toBe(false);
      const clear = [['gate-doorway', [0, 0, 92]], ['axis', [0, 0, 86]], ['courtyard', [5, 0, 68]], ['off-shadow-wall', [-10.47, 0, 108.2]]];
      for (const [, pos] of clear) expect(world.physics.checkManifestPose(probe, pos).clear).toBe(true);
    } finally { session.scene.close(); world.dispose(); }
  }, 60000);

  it('routes navigation through the gate doorway and around both halls', async () => {
    const session = await gardenSession();
    const world = session.world;
    try {
      const hop = await world.navigation.findPath([0, 0, 97], [0, 0, 87]);
      expect(hop.reachable).toBe(true);
      for (const point of hop.path) expect(Math.abs(point[0])).toBeLessThan(1.8);
      const route = await world.navigation.findPath([0, 0, 100], [0, 0, 50]);
      expect(route.reachable).toBe(true);
      expect(route.path.some((p) => inBox(p, 0, 80, 10, 4))).toBe(false);
      expect(route.path.some((p) => inBox(p, 0, 58, 14, 6))).toBe(false);
      expect(route.path.some((p) => Math.abs(p[2] - 92) < 1.2 && Math.abs(p[0]) > 1.8 && Math.abs(p[0]) < 7)).toBe(false);
    } finally { session.scene.close(); world.dispose(); }
  }, 60000);

  it('lets an agent pick up and place a cup on the courtyard table inside the region', async () => {
    const session = await gardenSession();
    const world = session.world;
    const scene = session.scene;
    try {
      await scene.addModel({ id: 'agent_01', asset: 'builtin://agent', position: [0, 0, 65] });
      await scene.addModel({ id: 'table_01', asset: 'builtin://table', position: [5, 0, 68] });
      await scene.addModel({ id: 'cup_01', asset: 'builtin://cup', position: [5.35, 1.05, 68] });
      const pickup = await driveJob(scene, world, await scene.interact({ action: 'pickup', actor: 'agent_01', target: 'cup_01' }));
      expect(pickup.status).toBe('succeeded');
      expect(pickup.result?.verification?.status).toBe('verified');
      const place = await driveJob(scene, world, await scene.interact({ action: 'place', actor: 'agent_01', target: 'table_01', surfaceId: 'top' }));
      expect(place.status).toBe('succeeded');
      expect(place.result?.verification?.status).toBe('verified');
      const cup = scene.observe().objects.find((o) => o.id === 'cup_01');
      expect(Math.abs(cup.position[0] - 5)).toBeLessThan(0.6);
      expect(Math.abs(cup.position[2] - 68)).toBeLessThan(0.6);
      expect(cup.position[1]).toBeGreaterThan(0.9);
      expect(cup.position[1]).toBeLessThan(1.3);
    } finally { session.scene.close(); world.dispose(); }
  }, 120000);
});
