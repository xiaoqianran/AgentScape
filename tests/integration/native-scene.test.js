import { it, expect, vi } from 'vitest';
import * as THREE from 'three';
import { attachNativeScene } from '../../application/native-scene/NativeSceneHost.js';
import { observeNativeRenderer, listNativeScenes } from '../../application/native-scene/NativeRenderDiscovery.js';

it('discovers multiple scenes without changing render receiver/results and restores render on release', () => {
  const calls = [];
  const renderer = { render(...args) { calls.push({ receiver: this, args }); return 42; } };
  const original = renderer.render;
  const release = observeNativeRenderer(renderer);
  const a = new THREE.Scene(), b = new THREE.Scene(), camera = new THREE.PerspectiveCamera();
  try {
    expect(renderer.render(a, camera, 'extra')).toBe(42);
    renderer.render(a, camera);
    renderer.render(b, camera);
    expect(calls[0]).toEqual({ receiver: renderer, args: [a, camera, 'extra'] });
    expect(listNativeScenes().filter(c => c.renderer === renderer).map(c => c.renders)).toEqual([2, 1]);
  } finally { release(); }
  expect(renderer.render).toBe(original);
  expect(listNativeScenes().some(c => c.renderer === renderer)).toBe(false);
  const releaseAgain = observeNativeRenderer(renderer);
  release();
  renderer.render(a, camera);
  expect(listNativeScenes().some(c => c.renderer === renderer)).toBe(true);
  releaseAgain();
});

it('injects physical assets into the exact native scene and detaches without touching native resources', async () => {
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera();
  const native = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.ShaderMaterial());
  const callback = native.onBeforeRender = vi.fn();
  scene.add(native);
  scene.background = new THREE.Color('red');
  const dispose = vi.spyOn(native.geometry, 'dispose');
  const renderer = { render: vi.fn(), dispose: vi.fn(), toneMappingExposure: 1.3, extensions: { has: () => false } };
  const options = { scene, camera, renderer, autoStart: false,
    colliders: [{ shape: 'box', halfExtents: [10, .1, 10], translation: [0, -.1, 0] }] };
  const host = await attachNativeScene(options);
  try {
    await expect(attachNativeScene(options)).rejects.toThrow('NATIVE_SCENE_ALREADY_ATTACHED');
    await host.scene.addModel({ id: 'cup', asset: 'builtin://cup', position: [2, 2, 0] });
    expect(scene.getObjectByProperty('uuid', host.world.store.get('cup').object.uuid)).toBe(host.world.store.get('cup').object);
    for (let i = 0; i < 240; i++) host.scene.frame(i * 1000 / 60);
    const y = host.world.physics.getPosition('cup')[1];
    expect(y).toBeGreaterThan(-.1);
    expect(y).toBeLessThan(.5);
    expect(renderer.render).not.toHaveBeenCalled();
    expect(renderer.toneMappingExposure).toBe(1.3);
    await expect(host.scene.setStyle('toon')).rejects.toThrow('NATIVE_RENDERING_OWNED_BY_PROJECT');
    await expect(host.scene.save()).rejects.toThrow('NATIVE_PROJECT_SAVE_UNSUPPORTED');
    expect(native.onBeforeRender).toBe(callback);
  } finally { host.close(); }
  host.close();
  expect(scene.children).toEqual([native]);
  expect(scene.background.getHexString()).toBe('ff0000');
  expect(dispose).not.toHaveBeenCalled();
  expect(renderer.dispose).not.toHaveBeenCalled();
  const again = await attachNativeScene(options);
  again.close();
  native.geometry.dispose(); native.material.dispose();
}, 30000);

it('rejects another Three.js instance and transformed scene roots before mounting', async () => {
  const options = { scene: new THREE.Scene(), camera: new THREE.PerspectiveCamera(), renderer: { render() {} }, autoStart: false };
  await expect(attachNativeScene({ ...options, three: { ...THREE, Object3D: class {} } })).rejects.toThrow('NATIVE_THREE_INSTANCE_MISMATCH');
  options.scene.position.x = 2;
  await expect(attachNativeScene(options)).rejects.toThrow('NATIVE_WORLD_TRANSFORM_UNSUPPORTED');
  expect(options.scene.children).toHaveLength(0);
});

it('releases a reserved scene when construction fails so a corrected binding can retry', async () => {
  const options = { scene: new THREE.Scene(), camera: new THREE.PerspectiveCamera(),
    renderer: { render() {}, extensions: { has: () => false } }, autoStart: false };
  await expect(attachNativeScene({ ...options, assetModule: {} })).rejects.toThrow('AssetModule');
  const session = await attachNativeScene(options);
  session.close();
  expect(options.scene.children).toHaveLength(0);
});

it('runs verified Agent navigation on registered native geometry using the shared interaction skills', async () => {
  const scene = new THREE.Scene();
  const floor = new THREE.Mesh(new THREE.BoxGeometry(24, .2, 24), new THREE.MeshStandardMaterial());
  floor.position.y = -.1;
  scene.add(floor);
  const host = await attachNativeScene({ scene, camera: new THREE.PerspectiveCamera(),
    renderer: { render() {}, extensions: { has: () => false } }, autoStart: false,
    navigationRoot: floor, colliders: [{ shape: 'box', halfExtents: [12, .1, 12], translation: [0, -.1, 0] }] });
  try {
    await host.scene.addModel({ id: 'walker', asset: 'builtin://agent', position: [0, 0, 2] });
    const job = host.scene.interact({ actor: 'walker', action: 'navigate', position: [3, 0, 3] });
    for (let i = 0; i < 3000 && host.scene.getJob(job.id).status === 'running'; i++) {
      host.scene.step();
      if (i % 12 === 0) await new Promise(resolve => setTimeout(resolve, 0));
      else await Promise.resolve();
    }
    expect(host.scene.getJob(job.id)).toMatchObject({ status: 'succeeded', result: { verification: { status: 'verified' } } });
    expect(host.world.physics.getPosition('walker')[0]).toBeGreaterThan(2.7);
  } finally { host.close(); floor.geometry.dispose(); floor.material.dispose(); }
}, 30000);
