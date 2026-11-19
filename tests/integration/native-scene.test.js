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
