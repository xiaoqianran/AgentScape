import { it, expect } from 'vitest';
import * as THREE from 'three';
import { WorldStorage } from '../../application/scene/WorldStorage.js';
import { attachNativeScene } from '../../application/native-scene/NativeSceneHost.js';

class MemoryBlocks {
  constructor() { this.blocks = new Map(); }
  async write(hash, bytes) {
    if (!this.blocks.has(hash)) this.blocks.set(hash, bytes.slice());
  }
  async read(hash, size) {
    const bytes = this.blocks.get(hash);
    if (!bytes || bytes.length !== size) throw new Error('MISSING_BLOCK');
    return bytes.slice();
  }
}
const renderer = () => ({ render() {}, dispose() { throw new Error('HOST_RENDERER_DISPOSED'); }, extensions: { has: () => false } });
const hostScene = () => {
  const scene = new THREE.Scene();
  const floor = new THREE.Mesh(new THREE.BoxGeometry(20, .2, 20), new THREE.MeshStandardMaterial());
  floor.position.y = -.1;
  scene.add(floor);
  return { scene, floor };
};
const attach = (scene, projectId = 'native-demo', revision = 'rev-1') =>
  attachNativeScene({
    scene, camera: new THREE.PerspectiveCamera(), renderer: renderer(), autoStart: false,
    colliders: [{ shape: 'box', halfExtents: [10, .1, 10], translation: [0, -.1, 0] }],
    hostProjectId: projectId, hostRevision: revision
  });

it('saves an AgentScape-only content-addressed overlay and restores it onto the same host without changing host camera or meshes', async () => {
  const blocks = new MemoryBlocks(), storage = new WorldStorage(blocks);
  const { scene, floor } = hostScene();
  const first = await attach(scene);
  const camera = first.scene.native.camera;
  camera.position.set(4, 5, 6);
  try {
    await first.scene.addModel({ id: 'saved_cup', asset: 'builtin://cup', position: [1, 2, 3] });
    await first.scene.addModel({ id: 'saved_agent', asset: 'builtin://agent', position: [2, 0, 1] });
    const root = await first.scene.saveOverlay(storage);
    expect(root.kind).toBe('native-overlay');
    const wrapper = await storage.node(root);
    expect(wrapper.data).toMatchObject({
      schema: 'agentscape.native-overlay', version: 1,
      host: { projectId: 'native-demo', revision: 'rev-1' }
    });
    const worldNode = await storage.node(wrapper.data.world);
    expect(worldNode.data.header.camera).toBeUndefined();
    expect(worldNode.data.header.metadata.stylePack).toBeUndefined();
    expect(worldNode.data.header.metadata.environmentState).toBeUndefined();
    expect(first.scene.capabilities.nativeOverlayPersistence).toBe(true);
    first.close();

    const second = await attach(scene);
    try {
      second.scene.native.camera.position.set(7, 8, 9);
      await second.scene.addModel({ id: 'temporary_object', asset: 'builtin://chair', position: [0, 0, 0] });
      const prepared = await second.scene.prepareOverlay(storage, root);
      expect(second.world.store.has('temporary_object')).toBe(true);
      await prepared.commit();
      expect(second.world.store.has('temporary_object')).toBe(false);
      expect(second.world.store.has('saved_cup')).toBe(true);
      expect(second.world.store.has('saved_agent')).toBe(true);
      expect(second.scene.native.camera.position.toArray()).toEqual([7, 8, 9]);
      expect(scene.children).toContain(floor);
      expect(floor.geometry).toBeTruthy();
    } finally { second.close(); }
  } finally {
    if (first.world && first.world.environment) first.close();
    floor.geometry.dispose(); floor.material.dispose();
  }
});

it('rejects a different host project or revision before mutating the live Runtime', async () => {
  const storage = new WorldStorage(new MemoryBlocks());
  const { scene: sourceScene, floor: sourceFloor } = hostScene();
  const source = await attach(sourceScene);
  let root;
  try {
    await source.scene.addModel({ id: 'saved_cup', asset: 'builtin://cup', position: [0, 1, 0] });
    root = await source.scene.saveOverlay(storage);
  } finally { source.close(); sourceFloor.geometry.dispose(); sourceFloor.material.dispose(); }

  const { scene, floor } = hostScene();
  const target = await attach(scene, 'another-project', 'rev-1');
  try {
    await target.scene.addModel({ id: 'keep_me', asset: 'builtin://chair', position: [0, 0, 0] });
    await expect(target.scene.prepareOverlay(storage, root)).rejects.toMatchObject({ code: 'NATIVE_HOST_PROJECT_MISMATCH' });
    expect(target.world.store.has('keep_me')).toBe(true);
    expect(target.world.store.has('saved_cup')).toBe(false);
  } finally { target.close(); floor.geometry.dispose(); floor.material.dispose(); }

  const { scene: revisionScene, floor: revisionFloor } = hostScene();
  const revisionTarget = await attach(revisionScene, 'native-demo', 'rev-2');
  try {
    await expect(revisionTarget.scene.restoreOverlay(storage, root)).rejects.toMatchObject({ code: 'NATIVE_HOST_REVISION_MISMATCH' });
    expect(revisionTarget.world.store.size).toBe(0);
  } finally { revisionTarget.close(); revisionFloor.geometry.dispose(); revisionFloor.material.dispose(); }
});

it('does not mutate the current Runtime when content blocks are corrupt or a prepared commit fails', async () => {
  const blocks = new MemoryBlocks(), storage = new WorldStorage(blocks);
  const { scene: sourceScene, floor: sourceFloor } = hostScene();
  const source = await attach(sourceScene);
  let root;
  try {
    await source.scene.addModel({ id: 'saved_cup', asset: 'builtin://cup', position: [0, 1, 0] });
    await source.scene.addModel({ id: 'fail_restore', asset: 'builtin://chair', position: [2, 0, 0] });
    root = await source.scene.saveOverlay(storage);
  } finally { source.close(); sourceFloor.geometry.dispose(); sourceFloor.material.dispose(); }

  const { scene, floor } = hostScene();
  const target = await attach(scene);
  try {
    await target.scene.addModel({ id: 'keep_me', asset: 'builtin://table', position: [0, 0, 0] });
    const originalSpawn = target.world.spawn.bind(target.world);
    target.world.spawn = async (assetId, options) => {
      if (options?.id === 'fail_restore') throw Object.assign(new Error('TEST_RESTORE_FAILURE'), { code: 'TEST_RESTORE_FAILURE' });
      return originalSpawn(assetId, options);
    };
    const prepared = await target.scene.prepareOverlay(storage, root);
    await expect(prepared.commit()).rejects.toMatchObject({ code: 'TEST_RESTORE_FAILURE' });
    prepared.dispose();
    expect(target.world.store.has('keep_me')).toBe(true);
    expect(target.world.store.has('saved_cup')).toBe(false);
    expect(target.world.store.has('fail_restore')).toBe(false);
    expect(scene.children).toContain(floor);

    const corrupt = await target.scene.saveOverlay(storage);
    blocks.blocks.set(corrupt.hash, new Uint8Array([1, 2, 3]));
    await expect(target.scene.prepareOverlay(storage, corrupt)).rejects.toThrow();
    expect(target.world.store.has('keep_me')).toBe(true);
  } finally { target.close(); floor.geometry.dispose(); floor.material.dispose(); }
});

it('exports and imports the overlay archive through the existing block archive protocol', async () => {
  const storage = new WorldStorage(new MemoryBlocks());
  const { scene, floor } = hostScene();
  const session = await attach(scene);
  try {
    await session.scene.addModel({ id: 'portable_cup', asset: 'builtin://cup', position: [0, 1, 0] });
    const root = await session.scene.saveOverlay(storage);
    const chunks = [];
    await session.scene.exportOverlay(storage, root, { write: async bytes => chunks.push(bytes.slice()) });
    const destination = new WorldStorage(new MemoryBlocks());
    const imported = await session.scene.importOverlay(destination, (async function* () { yield* chunks; })());
    expect(imported).toEqual(root);
    await session.scene.addModel({ id: 'temporary_after_export', asset: 'builtin://chair', position: [1, 0, 0] });
    await session.scene.restoreOverlay(destination, imported);
    expect(session.world.store.has('portable_cup')).toBe(true);
    expect(session.world.store.has('temporary_after_export')).toBe(false);
  } finally { session.close(); floor.geometry.dispose(); floor.material.dispose(); }
});

it('requires a stable host identity before enabling overlay persistence', async () => {
  const { scene, floor } = hostScene();
  const session = await attachNativeScene({
    scene, camera: new THREE.PerspectiveCamera(), renderer: renderer(), autoStart: false
  });
  try {
    expect(session.scene.capabilities.nativeOverlayPersistence).toBe(false);
    await expect(session.scene.saveOverlay(new WorldStorage(new MemoryBlocks())))
      .rejects.toMatchObject({ code: 'NATIVE_HOST_IDENTITY_REQUIRED' });
  } finally { session.close(); floor.geometry.dispose(); floor.material.dispose(); }
});