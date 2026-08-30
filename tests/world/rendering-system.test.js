import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { RenderingSystem } from '../../world/runtime/systems/RenderingSystem.js';

const createHarness = () => {
  const domElement = { remove: vi.fn() };
  const renderer = {
    backend: { isWebGLBackend:true, trackTimestamp:false },
    domElement,
    shadowMap: {},
    setPixelRatio: vi.fn(),
    setSize: vi.fn(),
    render: vi.fn(),
    dispose: vi.fn()
  };
  const container = {
    clientWidth: 800,
    clientHeight: 400,
    appendChild: vi.fn()
  };
  const controls = {
    enableDamping: false,
    target: new THREE.Vector3(),
    update: vi.fn(),
    dispose: vi.fn()
  };
  const rendererFactory = vi.fn(async () => ({ renderer, info:{ backend:'webgl2' } }));
  const controlsFactory = vi.fn(() => controls);
  return { renderer, container, controls, rendererFactory, controlsFactory, domElement };
};

describe('RenderingSystem', () => {
  it('owns renderer, camera, controls and environment presentation', async () => {
    const h = createHarness();
    const scene = new THREE.Scene();
    const rendering = new RenderingSystem({
      container:h.container,
      scene,
      rendererFactory:h.rendererFactory,
      controlsFactory:h.controlsFactory
    });

    await rendering.init();
    await rendering.applyEnvironment({
      rendering:{ background:0x112233, fog:{ color:0x334455, near:4, far:30 }, exposure:1.4 },
      camera:{ far:180, position:[2,3,4], target:[1,1,0] }
    });
    rendering.render(123);

    expect(h.container.appendChild).toHaveBeenCalledWith(h.domElement);
    expect(h.renderer.setSize).toHaveBeenCalledWith(800, 400, false);
    expect(rendering.camera.position.toArray()).toEqual([2,3,4]);
    expect(rendering.camera.far).toBe(180);
    expect(h.controls.target.toArray()).toEqual([1,1,0]);
    expect(scene.background.getHex()).toBe(0x112233);
    expect(scene.fog.near).toBe(4);
    expect(scene.fog.far).toBe(30);
    expect(h.renderer.toneMappingExposure).toBe(1.4);
    expect(h.renderer.render).toHaveBeenCalledWith(scene, rendering.camera);
  });

  it('owns IBL loading and releases the texture on dispose', async () => {
    const h = createHarness();
    const scene = new THREE.Scene();
    const texture = new THREE.Texture();
    texture.dispose = vi.fn();
    const environmentLoader = { loadAsync:vi.fn(async () => texture) };
    const rendering = new RenderingSystem({
      container:h.container,
      scene,
      rendererFactory:h.rendererFactory,
      controlsFactory:h.controlsFactory,
      environmentLoader
    });

    await rendering.init();
    expect(rendering.applyEnvironment({ rendering:{ ibl:{ url:'room.hdr', intensity:1.6 } } })).toBe(true);
    await rendering.environmentTask;

    expect(environmentLoader.loadAsync).toHaveBeenCalledWith('room.hdr');
    expect(scene.environment).toBe(texture);
    expect(scene.environmentIntensity).toBe(1.6);

    rendering.dispose();
    expect(scene.environment).toBeNull();
    expect(texture.dispose).toHaveBeenCalledOnce();
  });

  it('keeps the world usable when optional IBL loading fails', async () => {
    const h = createHarness();
    const scene = new THREE.Scene();
    const events = { emit:vi.fn() };
    const environmentLoader = { loadAsync:vi.fn(async () => { throw new Error('missing HDR'); }) };
    const rendering = new RenderingSystem({
      container:h.container,
      scene,
      events,
      rendererFactory:h.rendererFactory,
      controlsFactory:h.controlsFactory,
      environmentLoader
    });

    await rendering.init();
    const ok = rendering.applyEnvironment({
      rendering:{ background:0x123456, ibl:{ url:'missing.hdr' } },
      camera:{ position:[1,2,3], target:[0,1,0] }
    });

    expect(ok).toBe(true);
    expect(await rendering.environmentTask).toBe(false);
    expect(scene.background.getHex()).toBe(0x123456);
    expect(rendering.camera.position.toArray()).toEqual([1,2,3]);
    expect(events.emit).toHaveBeenCalledWith('renderer.environment-error', {
      url:'missing.hdr',
      message:'missing HDR'
    });
  });

  it('disposes rendering resources without owning the shared scene', async () => {
    const h = createHarness();
    const scene = new THREE.Scene();
    const child = new THREE.Group();
    scene.add(child);
    const rendering = new RenderingSystem({
      container:h.container,
      scene,
      rendererFactory:h.rendererFactory,
      controlsFactory:h.controlsFactory
    });

    await rendering.init();
    rendering.dispose();

    expect(h.controls.dispose).toHaveBeenCalledOnce();
    expect(h.renderer.dispose).toHaveBeenCalledOnce();
    expect(h.domElement.remove).toHaveBeenCalledOnce();
    expect(scene.children).toContain(child);
  });
  it('routes WebGPU frames through PostFX and exposes its diagnostics', async () => {
    const h = createHarness();
    h.renderer.backend = { isWebGPUBackend:true, trackTimestamp:false };
    h.rendererFactory.mockResolvedValue({ renderer:h.renderer, info:{ backend:'webgpu' } });
    const postFx = {
      enabled:true,
      render:vi.fn(),
      dispose:vi.fn(),
      diagnostics:vi.fn(() => ({ enabled:true, backend:'webgpu', effects:['gtao','bloom','fxaa'] }))
    };
    const postFxFactory = vi.fn(() => postFx);
    const rendering = new RenderingSystem({
      container:h.container,
      scene:new THREE.Scene(),
      rendererFactory:h.rendererFactory,
      controlsFactory:h.controlsFactory,
      postFxFactory
    });

    await rendering.init();
    rendering.render(42);

    expect(postFxFactory).toHaveBeenCalledOnce();
    expect(postFx.render).toHaveBeenCalledOnce();
    expect(h.renderer.render).not.toHaveBeenCalled();
    expect(rendering.diagnostics().postfx).toEqual({
      enabled:true,
      backend:'webgpu',
      effects:['gtao','bloom','fxaa']
    });

    rendering.dispose();
    expect(postFx.dispose).toHaveBeenCalledOnce();
  });

  it('reuses a pure-data view pose snapshot instead of allocating every frame', async () => {
    const h = createHarness();
    const rendering = new RenderingSystem({
      container:h.container,
      scene:new THREE.Scene(),
      rendererFactory:h.rendererFactory,
      controlsFactory:h.controlsFactory
    });

    await rendering.init();
    rendering.camera.position.set(1,2,3);
    rendering.camera.quaternion.set(0,0,0,1);
    const first = rendering.viewPose();
    rendering.camera.position.set(4,5,6);
    const second = rendering.viewPose();

    expect(second).toBe(first);
    expect(second.position).toBe(first.position);
    expect(second.rotation).toBe(first.rotation);
    expect(second).toEqual({ position:[4,5,6], rotation:[0,0,0,1] });
  });

  it('falls back to direct rendering if the WebGPU PostFX pipeline fails', async () => {
    const h = createHarness();
    const scene = new THREE.Scene();
    const events = { emit:vi.fn() };
    const postFx = {
      enabled:true,
      render:vi.fn(() => { throw new Error('shader compile failed'); }),
      dispose:vi.fn(),
      diagnostics:vi.fn(() => ({ enabled:true, backend:'webgpu', effects:['gtao'] }))
    };
    const rendering = new RenderingSystem({
      container:h.container,
      scene,
      events,
      rendererFactory:h.rendererFactory,
      controlsFactory:h.controlsFactory,
      postFxFactory:() => postFx
    });

    await rendering.init();
    rendering.render(99);

    expect(postFx.dispose).toHaveBeenCalledOnce();
    expect(rendering.postFx).toBeNull();
    expect(h.renderer.render).toHaveBeenCalledWith(scene, rendering.camera);
    expect(events.emit).toHaveBeenCalledWith('renderer.postfx-error', {
      message:'shader compile failed',
      postfx:{ enabled:true, backend:'webgpu', effects:['gtao'] }
    });
  });
});
