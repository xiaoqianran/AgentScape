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

it('never re-discovers scenes through stale renderer wrappers after release', () => {
  const renderer = { render: vi.fn(() => 41) };
  const release = observeNativeRenderer(renderer);
  const wrapped = renderer.render;
  release();
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera();
  // A project may retain a reference to the old wrapped callback.
  expect(wrapped.call(renderer, scene, camera)).toBe(41);
  expect(listNativeScenes().some(candidate => candidate.renderer === renderer)).toBe(false);
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

it('supports native component and semantic injection with rollback-safe cleanup', async () => {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera();
  const renderer = { render() {}, extensions: { has: () => false } };
  const component = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshPhysicalMaterial({ transmission: 0.2 }));
  let attachedContext;
  const host = await attachNativeScene({ scene, camera, renderer, autoStart: false,
    onAttach(context) {
      attachedContext = context;
      const injected = context.native.addComponent({
        id: 'native-glass', object: component, parent: context.native.scene,
        semantic: { label: '原生玻璃', read: () => ({ material: component.material.type }) },
      });
      expect(injected.object).toBe(component);
    } });
  try {
    expect(attachedContext.three).toBe(THREE);
    expect(scene.getObjectById(component.id)).toBe(component);
    expect(host.world.entities.describe('native-glass')).toMatchObject({ source:'native', capabilities:['semantic'], transformAuthority:'host', phase:'visual-mounted' });
    expect(host.scene.observe().project.entities).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'native-glass', label: '原生玻璃' }),
    ]));
    expect(() => host.scene.native.addComponent({ id: 'native-glass', object: new THREE.Group() }))
      .toThrow('NATIVE_COMPONENT_CONFLICT');
  } finally {
    host.close();
  }
  expect(scene.getObjectById(component.id)).toBeUndefined();
  expect(host.world.entities.has('native-glass')).toBe(false);
  expect(component.geometry).toBeDefined();
  expect(component.material).toBeDefined();
  component.geometry.dispose();
  component.material.dispose();
});

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

it('preserves a native material, light, shader and renderer loop while injecting semantics', async () => {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#101820');
  const camera = new THREE.PerspectiveCamera(45, 16 / 9, 0.1, 100);
  const renderer = { render: vi.fn(), extensions: { has: () => false }, toneMapping: THREE.ACESFilmicToneMapping };
  const light = new THREE.DirectionalLight(0xffffff, 2.5);
  light.castShadow = true;
  const floor = new THREE.Mesh(new THREE.BoxGeometry(12, .2, 12), new THREE.MeshStandardMaterial({ color: '#5f7480', roughness: .72 }));
  floor.receiveShadow = true;
  const shaderMaterial = new THREE.ShaderMaterial({
    uniforms: { time: { value: 0 } },
    vertexShader: 'void main() { gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: 'uniform float time; void main() { gl_FragColor = vec4(0.2 + 0.1 * sin(time), 0.6, 0.9, 1.0); }',
  });
  const shaderObject = new THREE.Mesh(new THREE.TorusGeometry(1, .2, 16, 32), shaderMaterial);
  scene.add(light, floor, shaderObject);
  const host = await attachNativeScene({ scene, camera, renderer, autoStart: false });
  try {
    expect(host.scene.native.scene).toBe(scene);
    expect(host.scene.native.camera).toBe(camera);
    expect(host.scene.native.renderer).toBe(renderer);
    expect(scene.background).toBeInstanceOf(THREE.Color);
    expect(floor.material).toBeInstanceOf(THREE.MeshStandardMaterial);
    expect(shaderObject.material).toBe(shaderMaterial);
    expect(light.castShadow).toBe(true);
    host.scene.frame(16);
    expect(renderer.render).not.toHaveBeenCalled();
  } finally {
    host.close();
    floor.geometry.dispose();
    floor.material.dispose();
    shaderObject.geometry.dispose();
    shaderMaterial.dispose();
  }
  expect(scene.children).toEqual([light, floor, shaderObject]);
}, 30000);

it('registers native components as spatial audio emitters only when host audio dependencies are supplied', async () => {
  const scene = new THREE.Scene();
  const listener = {
    context: {
      currentTime: 2,
      createOscillator: vi.fn(() => ({
        type: 'sine',
        frequency: { setValueAtTime: vi.fn() },
        connect: vi.fn(),
        disconnect: vi.fn(),
        start: vi.fn(),
        stop: vi.fn(),
      })),
      createGain: vi.fn(() => ({
        gain: { setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn() },
        connect: vi.fn(),
        disconnect: vi.fn(),
      })),
      close: vi.fn(),
    },
    getInput: vi.fn(),
  };
  class PositionalAudio extends THREE.Object3D {
    constructor() {
      super();
      this.panner = { connect: vi.fn(), disconnect: vi.fn() };
    }
    setRefDistance() { return this; }
    setRolloffFactor() { return this; }
    disconnect() {}
  }

  const host = await attachNativeScene({
    scene,
    camera: new THREE.PerspectiveCamera(),
    renderer: { render() {}, extensions: { has: () => false } },
    audioListener: listener,
    audioThree: { PositionalAudio },
    autoStart: false,
  });
  const object = new THREE.Group();
  const component = host.scene.native.addComponent({ id: 'bell', object, audio: true });

  expect(host.world.entities.get('bell').phase).toBe('audio-registered');
  host.scene.native.audio.scheduleNote('bell', { frequency: 440, duration: 0.2 });
  expect(listener.context.createOscillator).toHaveBeenCalledOnce();

  component.remove();
  expect(host.world.entities.has('bell')).toBe(false);
  expect(object.children).toHaveLength(0);

  host.close();
  expect(listener.context.close).not.toHaveBeenCalled();
});

it('binds existing nested host objects without taking ownership of their hierarchy', async () => {
  const scene = new THREE.Scene();
  const parent = new THREE.Group();
  const object = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial());
  parent.position.set(2, 3, 4);
  object.position.set(1, 2, 3);
  parent.add(object);
  scene.add(parent);
  const host = await attachNativeScene({ scene, camera: new THREE.PerspectiveCamera(),
    renderer: { render() {}, extensions: { has: () => false } }, autoStart: false });
  try {
    const bind = host.scene.native.bindComponent;
    const component = bind({ id: 'existing', object, semantic: { label: 'Existing' } });
    expect(object.parent).toBe(parent);
    expect(object.position.toArray()).toEqual([1, 2, 3]);
    expect(host.scene.observe().project.entities).toEqual(expect.arrayContaining([expect.objectContaining({ id: 'existing' })]));
    expect(() => bind({ id: 'duplicate', object })).toThrow('NATIVE_COMPONENT_CONFLICT');
    expect(component.remove()).toBe(true);
    expect(component.remove()).toBe(false);
    expect(object.parent).toBe(parent);
    expect(host.world.entities.has('existing')).toBe(false);
    expect(() => bind({ id: 'failure', object, audio: true })).toThrow('NATIVE_AUDIO_UNAVAILABLE');
    expect(object.parent).toBe(parent);
    expect(host.world.entities.has('failure')).toBe(false);
    expect(() => bind({ id: 'outside', object: new THREE.Group() })).toThrow('NATIVE_COMPONENT_NOT_IN_HOST_SCENE');
    bind({ id: 'existing', object });
  } finally {
    host.close();
  }
  expect(object.parent).toBe(parent);
  expect(scene.children).toContain(parent);
  expect(() => host.scene.native.bindComponent({ id: 'closed', object })).toThrow('SCENE_CLOSED');
  object.geometry.dispose();
  object.material.dispose();
});

it('keeps host objects in place when the attach hook fails', async () => {
  const scene = new THREE.Scene();
  const parent = new THREE.Group();
  const object = new THREE.Group();
  parent.add(object);
  scene.add(parent);
  await expect(attachNativeScene({ scene, camera: new THREE.PerspectiveCamera(),
    renderer: { render() {}, extensions: { has: () => false } }, autoStart: false,
    onAttach({ native }) {
      native.bindComponent({ id: 'existing', object, semantic: { label: 'Existing' } });
      throw new Error('hook failure');
    },
  })).rejects.toThrow('hook failure');
  expect(object.parent).toBe(parent);
  expect(scene.children).toEqual([parent]);
});

it('simulates an existing nested host object in world space and releases its body', async () => {
  const scene = new THREE.Scene();
  const parent = new THREE.Group();
  parent.position.set(3, 1, -2);
  parent.rotation.y = Math.PI / 3;
  const object = new THREE.Group();
  object.position.set(1, 2, 0);
  parent.add(object);
  scene.add(parent);
  const host = await attachNativeScene({ scene, camera: new THREE.PerspectiveCamera(),
    renderer: { render() {}, extensions: { has: () => false } }, autoStart: false,
    colliders: [{ shape: 'box', halfExtents: [10, .1, 10], translation: [0, -.1, 0] }] });
  try {
    const physics = { body: 'dynamic', mass: 1, colliders: [{ shape: 'box', halfExtents: [.2, .2, .2] }] };
    const binding = host.scene.native.bindComponent({ id: 'physical-host', object, physics });
    expect(host.world.entities.describe('physical-host')).toMatchObject({ transformAuthority: 'physics', phase: 'physics-registered' });
    for (let i = 0; i < 240; i++) host.scene.frame(i * 1000 / 60);
    const position = object.getWorldPosition(new THREE.Vector3());
    const bodyPosition = host.world.physics.getPosition('physical-host');
    expect(position.y).toBeGreaterThan(.15);
    expect(position.y).toBeLessThan(.3);
    expect(position.distanceTo(new THREE.Vector3(...bodyPosition))).toBeLessThan(1e-5);
    expect(object.parent).toBe(parent);
    binding.remove();
    expect(host.world.physics.entries.has('physical-host')).toBe(false);
    expect(object.parent).toBe(parent);
    expect(() => host.scene.native.bindComponent({ id: 'bad', object, physics: { body: 'dynamic', colliders: [] } })).toThrow('NATIVE_PHYSICS_INVALID');
    expect(() => host.scene.native.bindComponent({ id: 'rollback', object, physics, audio: true })).toThrow('NATIVE_AUDIO_UNAVAILABLE');
    expect(host.world.physics.entries.has('rollback')).toBe(false);
    expect(host.world.entities.has('rollback')).toBe(false);
    expect(object.parent).toBe(parent);
  } finally {
    host.close();
  }
});


it('uses a bound host object as a fixed collider and removes it on unbind', async () => {
  const scene = new THREE.Scene();
  const platform = new THREE.Group();
  const falling = new THREE.Group();
  platform.position.set(2, 1, 0);
  falling.position.set(2, 3, 0);
  scene.add(platform, falling);
  const host = await attachNativeScene({ scene, camera: new THREE.PerspectiveCamera(),
    renderer: { render() {}, extensions: { has: () => false } }, autoStart: false });
  try {
    const fixed = host.scene.native.bindComponent({ id: 'platform', object: platform,
      physics: { body: 'fixed', colliders: [{ shape: 'box', halfExtents: [1, .1, 1] }] } });
    host.scene.native.bindComponent({ id: 'falling', object: falling,
      physics: { body: 'dynamic', colliders: [{ shape: 'box', halfExtents: [.2, .2, .2] }] } });
    for (let i = 0; i < 240; i++) host.scene.frame(i * 1000 / 60);
    expect(falling.getWorldPosition(new THREE.Vector3()).y).toBeGreaterThan(1.25);
    expect(falling.getWorldPosition(new THREE.Vector3()).y).toBeLessThan(1.35);
    expect(platform.position.toArray()).toEqual([2, 1, 0]);
    fixed.remove();
    expect(host.world.physics.entries.has('platform')).toBe(false);
    for (let i = 240; i < 360; i++) host.scene.frame(i * 1000 / 60);
    expect(falling.getWorldPosition(new THREE.Vector3()).y).toBeLessThan(1);
    expect(platform.parent).toBe(scene);
  } finally {
    host.close();
  }
});


it('registers and removes explicit host component actions through the scene API', async () => {
  const scene = new THREE.Scene();
  const object = new THREE.Group();
  scene.add(object);
  const host = await attachNativeScene({ scene, camera: new THREE.PerspectiveCamera(),
    renderer: { render() {}, extensions: { has: () => false } }, autoStart: false });
  let opened = false;
  try {
    const component = host.scene.native.bindComponent({ id: 'door', object,
      semantic: { read: () => ({ opened }) },
      actions: [{ name: 'open', execute: (_args, context) => {
        expect(context.object).toBe(object);
        opened = true;
      }, verify: ({ after }) => after.opened === true }] });
    expect(host.world.entities.describe('door').capabilities).toContain('interaction');
    expect(host.scene.inspect('door').actions).toEqual(expect.arrayContaining([expect.objectContaining({ name: 'open' })]));
    const job = host.scene.interact({ action: 'custom', target: 'door', name: 'open' });
    expect(await host.scene.waitJob(job.id)).toMatchObject({ status: 'succeeded', result: { verification: { status: 'verified' } } });
    expect(opened).toBe(true);
    component.remove();
    expect(host.world.projectCapabilities.has('door')).toBe(false);
    expect(object.parent).toBe(scene);
    expect(() => host.scene.native.bindComponent({ id: 'bad-actions', object, actions: [
      { name: 'open', execute() {} }, { name: 'open', execute() {} }
    ] })).toThrow('PROJECT_ACTION_CONFLICT');
    expect(host.world.projectCapabilities.has('bad-actions')).toBe(false);
    expect(host.world.entities.has('bad-actions')).toBe(false);
    expect(object.parent).toBe(scene);
  } finally {
    host.close();
  }
});


it('keeps native component resources until an asynchronous action settles', async () => {
  const scene = new THREE.Scene();
  const object = new THREE.Group();
  scene.add(object);
  const host = await attachNativeScene({ scene, camera: new THREE.PerspectiveCamera(),
    renderer: { render() {}, extensions: { has: () => false } }, autoStart: false });
  let release;
  let markStarted;
  const pending = new Promise(resolve => { release = resolve; });
  const started = new Promise(resolve => { markStarted = resolve; });
  try {
    const component = host.scene.native.bindComponent({ id: 'busy-object', object,
      physics: { body: 'dynamic', colliders: [{ shape: 'box', halfExtents: [0.5, 0.5, 0.5] }] },
      actions: [{ name: 'wait', execute: async () => { markStarted(); await pending; } }] });
    const job = host.scene.interact({ action: 'custom', target: 'busy-object', name: 'wait' });
    await started;
    host.scene.cancelJob(job.id);
    expect(() => component.remove()).toThrow('SCENE_BUSY');
    expect(() => host.scene.native.bindComponent({ id: 'other', object: new THREE.Group() })).toThrow('SCENE_BUSY');
    expect(host.world.physics.entries.has('busy-object')).toBe(true);
    expect(host.world.projectCapabilities.has('busy-object')).toBe(true);
    release();
    expect(await host.scene.waitJob(job.id)).toMatchObject({ status: 'cancelled' });
    expect(component.remove()).toBe(true);
    expect(host.world.physics.entries.has('busy-object')).toBe(false);
    expect(object.parent).toBe(scene);
  } finally {
    release();
    host.close();
  }
});


it('restores the original host hierarchy when mounting fails', async () => {
  const scene = new THREE.Scene();
  const parent = new THREE.Group();
  const first = new THREE.Group();
  const second = new THREE.Group();
  const last = new THREE.Group();
  parent.add(first, second, last);
  scene.add(parent);
  const options = { scene, camera: new THREE.PerspectiveCamera(),
    renderer: { render() {}, extensions: { has: () => false } }, autoStart: false };
  const host = await attachNativeScene(options);
  try {
    expect(() => host.scene.native.addComponent({ id: 'failure', object: second, audio: true }))
      .toThrow('NATIVE_AUDIO_UNAVAILABLE');
    expect(parent.children).toEqual([first, second, last]);
    expect(host.world.entities.has('failure')).toBe(false);
    expect(() => host.scene.native.addComponent({ id: 'cycle', object: parent, parent: second }))
      .toThrow('NATIVE_COMPONENT_PARENT_INVALID');
    expect(parent.children).toEqual([first, second, last]);
  } finally {
    host.close();
  }
  await expect(attachNativeScene({ ...options, onAttach({ native }) {
    native.addComponent({ id: 'first', object: first });
    native.addComponent({ id: 'second', object: second });
    throw new Error('hook failure');
  } })).rejects.toThrow('hook failure');
  expect(parent.children).toEqual([first, second, last]);
  const reopened = await attachNativeScene(options);
  reopened.close();
});


it('syncs a host-driven kinematic collider without taking ownership of its transform', async () => {
  const scene = new THREE.Scene();
  const parent = new THREE.Group();
  parent.position.set(2, 1, -1);
  parent.rotation.y = Math.PI / 4;
  const platform = new THREE.Group();
  parent.add(platform);
  scene.add(parent);
  const host = await attachNativeScene({ scene, camera: new THREE.PerspectiveCamera(),
    renderer: { render() {}, extensions: { has: () => false } }, autoStart: false });
  try {
    const component = host.scene.native.bindComponent({ id: 'moving-platform', object: platform,
      physics: { body: 'kinematic', colliders: [{ shape: 'box', halfExtents: [1, .1, 1] }] } });
    expect(host.world.entities.describe('moving-platform').transformAuthority).toBe('host');
    host.scene.frame(0);
    platform.position.set(1, 0, 0);
    platform.rotation.y = .5;
    host.scene.frame(1000 / 60);
    host.scene.frame(2000 / 60);
    const expectedPosition = platform.getWorldPosition(new THREE.Vector3());
    const expectedRotation = platform.getWorldQuaternion(new THREE.Quaternion());
    expect(new THREE.Vector3(...host.world.physics.getPosition('moving-platform')).distanceTo(expectedPosition)).toBeLessThan(1e-5);
    expect(1 - Math.abs(new THREE.Quaternion(...host.world.physics.getRotation('moving-platform')).dot(expectedRotation))).toBeLessThan(1e-5);
    expect(platform.position.toArray()).toEqual([1, 0, 0]);
    const falling = new THREE.Group();
    falling.position.copy(expectedPosition).add(new THREE.Vector3(0, 2, 0));
    scene.add(falling);
    host.scene.native.bindComponent({ id: 'kinematic-falling', object: falling,
      physics: { body: 'dynamic', colliders: [{ shape: 'box', halfExtents: [.2, .2, .2] }] } });
    for (let i = 0; i < 180; i++) host.scene.step();
    expect(falling.position.y).toBeGreaterThan(expectedPosition.y + .25);
    expect(falling.position.y).toBeLessThan(expectedPosition.y + .35);
    platform.position.x += 4;
    for (let i = 0; i < 120; i++) host.scene.step();
    expect(falling.position.y).toBeLessThan(expectedPosition.y);
    expect(component.remove()).toBe(true);
    expect(host.world.physics.entries.has('moving-platform')).toBe(false);
    expect(platform.parent).toBe(parent);
  } finally { host.close(); }
});

it.each(['capsule', 'cylinder'])('simulates native %s colliders and rejects invalid dimensions', async shape => {
  const scene = new THREE.Scene();
  const platform = new THREE.Group();
  const object = new THREE.Group();
  object.position.y = 2;
  scene.add(platform, object);
  const host = await attachNativeScene({ scene, camera: new THREE.PerspectiveCamera(),
    renderer: { render() {}, extensions: { has: () => false } }, autoStart: false });
  try {
    host.scene.native.bindComponent({ id: 'floor', object: platform,
      physics: { body: 'fixed', colliders: [{ shape: 'box', halfExtents: [3, .1, 3] }] } });
    const binding = host.scene.native.bindComponent({ id: 'round', object,
      physics: { body: 'dynamic', colliders: [{ shape, radius: .2, halfHeight: .3 }] } });
    for (let i = 0; i < 180; i++) host.scene.step();
    expect(object.position.y).toBeGreaterThan(.35);
    expect(object.position.y).toBeLessThan(.7);
    expect(binding.remove()).toBe(true);
    expect(object.parent).toBe(scene);
    expect(() => host.scene.native.bindComponent({ id: 'invalid', object,
      physics: { body: 'dynamic', colliders: [{ shape, radius: 0, halfHeight: .3 }] } })).toThrow('NATIVE_PHYSICS_INVALID');
  } finally { host.close(); }
});

it.each([
  { shape: 'box', halfExtents: [.1, 1, .5] },
  { shape: 'cylinder', radius: .1, halfHeight: 1 },
  { shape: 'capsule', radius: .1, halfHeight: 1 },
])('applies local rotation to a native $shape collider', async collider => {
  const scene = new THREE.Scene();
  const platform = new THREE.Group();
  const object = new THREE.Group();
  object.position.set(.7, 2, 0);
  scene.add(platform, object);
  const host = await attachNativeScene({ scene, camera: new THREE.PerspectiveCamera(),
    renderer: { render() {}, extensions: { has: () => false } }, autoStart: false });
  try {
    const rotation = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI / 2).toArray();
    host.scene.native.bindComponent({ id: 'rotated-platform', object: platform,
      physics: { body: 'fixed', colliders: [{ ...collider, rotation }] } });
    host.scene.native.bindComponent({ id: 'falling-object', object,
      physics: { body: 'dynamic', colliders: [{ shape: 'box', halfExtents: [.1, .1, .1] }] } });
    for (let i = 0; i < 180; i++) host.scene.step();
    expect(object.position.y).toBeGreaterThan(.15);
    expect(object.position.y).toBeLessThan(.3);
    expect(() => host.scene.native.addComponent({ id: 'invalid-rotation', object: new THREE.Group(),
      physics: { body: 'fixed', colliders: [{ ...collider, rotation: [0, 0, 0, 0] }] } })).toThrow('NATIVE_PHYSICS_INVALID');
  } finally { host.close(); }
});
