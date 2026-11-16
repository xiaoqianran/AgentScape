import { it, expect } from 'vitest';
import { createSession } from '../../application/createSession.js';
import { createMonumentHall } from '../../modules/world/content/monumentHall.js';
import { createAssetModule } from '../../modules/asset/AssetModule.js';
import { compileRecipeGeometry } from '../../modules/asset/production/AssetRecipe.js';
import { createHeadlessGLTFLoader } from '../../apps/mcp-server/HeadlessGLTFLoader.js';
import { installHeadlessAssetIO } from '../../apps/mcp-server/HeadlessAssetIO.js';
import { openScenePackage } from '../../application/scene/ScenePackage.js';

// ASSET-039 (criterion 3): a capability that was proposed from evidence,
// reviewed and registered must rebind after save/reopen — and only that
// reviewed capability; unreviewed generic operations stay unavailable.
it('rebinds only the reviewed capability after save and reopen', async () => {
  installHeadlessAssetIO();
  const parts = [
    { id: 'base', position: [-.6, .1, 0], geometry: { type: 'box', size: [.2, .2, .2] } },
    { id: 'drawer_mesh', position: [0, .8, 0], geometry: { type: 'box', size: [.4, .2, .4] } }
  ];
  const bytes = (await compileRecipeGeometry({ schema: 'agentscape.asset-recipe', schemaVersion: 1, id: 'fixture/drawer', parts })).bytes;
  const session = createSession(null, { assetModule: createAssetModule({ gltfLoader: createHeadlessGLTFLoader() }), environmentFactory: () => createMonumentHall({ loadAssets: false }) });
  await session.world.init();
  const { scene, world } = session;
  let reopened;
  try {
    await scene.addModel({ id: 'actor', asset: 'builtin://agent' });
    const source = { kind: 'glb', bytes, name: 'unseen_drawer.glb' };
    const proposal = await scene.prepareAsset(source);
    expect(proposal.operations.every(operation => !operation.executable && !operation.physicsVerified)).toBe(true);
    const review = { proposalId: proposal.proposalId, confirmed: true,
      physics: { body: 'fixed', mass: 1, friction: .5 },
      parts: proposal.parts.map(part => ({ id: part.id, node: part.node, parent: part.parent || '$root',
        physics: { body: 'dynamic', mass: 1, friction: .5 },
        joint: { type: part.joint.type, axis: [0, 0, 1], parentAnchor: [0, .8, 0], childAnchor: [0, 0, 0], limits: [0, .3] } })) };
    const imported = await scene.addModel({ id: 'imported', asset: { ...source, review }, position: [.65, 0, 0] });
    expect(imported.admission.layers.runtime.status).toBe('ready');

    const saved = await scene.save();
    expect(saved.value.assets).toHaveLength(1);
    expect(saved.value.assets[0].bytes.length).toBeGreaterThan(0);

    reopened = await openScenePackage(saved.value);
    expect(reopened.observe().objects.map(object => object.id)).toEqual(expect.arrayContaining(['actor', 'imported']));
    const actions = reopened.inspect('imported', { actor: 'actor' }).actions;
    expect(actions.find(entry => entry.action === 'slide')).toMatchObject({ available: true });
    for (const action of ['push', 'drag', 'rotate']) {
      expect(actions.find(entry => entry.action === action), action).toMatchObject({ available: false });
    }
    const finish = async (job) => {
      for (let n = 0; n < 1200 && reopened.getJob(job.id).status === 'running'; n++) {
        reopened.step();
        if (n % 12 === 0) await new Promise(resolve => setTimeout(resolve, 0)); else await Promise.resolve();
      }
      expect(reopened.getJob(job.id).status).not.toBe('running');
      return reopened.waitJob(job.id);
    };
    const done = await finish(reopened.interact({ actor: 'actor', target: 'imported', action: 'slide', args: { part: proposal.parts[0].id, target: .25 } }));
    expect(done.status).toBe('succeeded');
    expect(done.result.value.physicsVerified).toBe(true);
    expect(Math.abs(done.result.value.coordinate - .25)).toBeLessThan(.03);
  } finally {
    reopened?.close();
    scene.close();
    world.dispose();
  }
}, 120000);
