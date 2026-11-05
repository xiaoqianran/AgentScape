import { it, expect } from 'vitest';
import { createSession } from '../../application/createSession.js';
import { createMonumentHall } from '../../modules/world/content/monumentHall.js';
import { createAssetModule } from '../../modules/asset/AssetModule.js';
import { createHeadlessGLTFLoader } from '../../apps/mcp-server/HeadlessGLTFLoader.js';
import { installHeadlessAssetIO } from '../../apps/mcp-server/HeadlessAssetIO.js';
import { readFile } from 'node:fs/promises';
import { assetManifests } from '../../modules/asset/registry/manifests/index.js';

it('discovers live asset and environment capabilities without storing a second object state', async () => {
  installHeadlessAssetIO();
  const manifests = structuredClone(assetManifests);
  const bytes = await readFile(new URL('../../public/assets/cabinet.glb', import.meta.url));
  manifests.cabinet.source.url = `data:model/gltf-binary;base64,${bytes.toString('base64')}`;
  const session = createSession(null, { assetModule: createAssetModule({ manifests, gltfLoader: createHeadlessGLTFLoader() }), environmentFactory: () => createMonumentHall({ loadAssets: false }) });
  await session.world.init();
  const { scene, world } = session;
  const action = (id, name, options) => scene.inspect(id, options).actions.find(entry => entry.action === name);
  try {
    for (const asset of ['agent', 'chair', 'cup', 'cabinet']) await scene.addModel({ id: asset, asset: `builtin://${asset}` });
    await scene.addModel({ id: 'visual', asset: { schema: 'agentscape.asset-recipe', schemaVersion: 1,
      id: 'test/visual', parts: [{ id: 'body', geometry: { type: 'box', size: [1, 1, 1] } }] } });
    expect(scene.inspect('visual')).toMatchObject({ source: 'asset', physics: { registered: false } });
    expect(scene.inspect('visual').actions.map(entry => entry.action)).toEqual(['inspect', 'setTransform']);
    expect(action('chair', 'push')).toMatchObject({ available: false, reason: 'TARGET_NOT_DYNAMIC' });
    expect(action('chair', 'setTransform')).toMatchObject({ available: true, execution: 'editor' });
    expect(action('cup', 'push')).toMatchObject({ available: false, reason: 'EXECUTOR_UNAVAILABLE' });
    expect(action('cup', 'pickup')).toMatchObject({ available: null, reason: 'ACTOR_REQUIRED_FOR_REACH_CHECK' });
    expect(action('cup', 'pickup', { actor: 'absent' })).toMatchObject({ available: false, reason: 'ACTOR_NOT_FOUND' });
    expect(action('cup', 'pickup', { actor: 'chair' })).toMatchObject({ available: false, reason: 'ACTOR_NOT_AGENT' });
    expect(action('cabinet', 'open')).toMatchObject({ partName: expect.any(String), parameters: { partName: { required: true } }, contract: { action: 'open' }, joint: { type: 'revolute' } });
    expect(action('chair', 'place', { actor: 'agent' })).toMatchObject({ available: false, reason: 'NOT_HOLDING_OBJECT' });
    const nearbyChair = world.queries.listInteractablesNearMe({ actorId: 'agent' }).affordances.find(entry => entry.id === 'chair');
    expect(nearbyChair).toMatchObject({ source: 'asset', available: false });
    expect(nearbyChair.actions.find(entry => entry.action === 'setTransform')).toMatchObject({ execution: 'editor', available: true });
    await scene.setTransform({ id: 'cup', transform: { position: [20, 0, 0] } });
    expect(action('cup', 'pickup', { actor: 'agent' })).toMatchObject({ available: false, reason: 'OUT_OF_REACH' });
    world.store.get('cup').state.heldBy = { kind: 'human' };
    expect(action('cup', 'pickup', { actor: 'agent' })).toMatchObject({ available: false, reason: 'OBJECT_ALREADY_HELD' });
    expect(action('cup', 'setTransform')).toMatchObject({ available: false, reason: 'OBJECT_HELD' });
    delete world.store.get('cup').state.heldBy;
    const snapshot = scene.inspect('cup'); snapshot.state.test = true;
    expect(scene.inspect('cup').state.test).toBeUndefined();
    world.environment.affordances = [{ id: 'test:lamp', label: 'Lamp', kind: 'switch', position: [0, 1, 0],
      actions: ['turn_on'], read: () => ({ on: false }), evidenceKind: 'device-state' }];
    expect(scene.inspect('test:lamp')).toMatchObject({ schema: snapshot.schema, source: 'environment', actions: [{ action: 'turn_on', parameters: {}, execution: 'world-action' }] });
    expect(scene.observe().affordances.entities.map(entry => entry.id)).toEqual(expect.arrayContaining(['cup', 'chair', 'cabinet', 'visual', 'test:lamp']));
    await scene.remove({ id: 'cup' });
    expect(() => scene.inspect('cup')).toThrow('OBJECT_NOT_FOUND');
    scene.close();
    expect(() => scene.inspect('chair')).toThrow('SCENE_CLOSED');
  } finally { scene.close(); world.dispose(); }
});
