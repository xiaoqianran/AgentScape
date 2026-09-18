import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { WorldRuntime } from '../../modules/world/runtime/WorldRuntime.js';

const environment = () => {
  const root = new THREE.Group();
  const floor = new THREE.Mesh(new THREE.BoxGeometry(4, 0.2, 4), new THREE.MeshBasicMaterial());
  root.add(floor);
  return { id:'headless-world', root, floor, colliders:[], dispose:vi.fn() };
};

const assetModule = () => {
  const loader={ instantiate:vi.fn(), configureRenderer:vi.fn() };
  return {
    registry:{ getManifest:vi.fn(), has:vi.fn(() => false) },
    loader,
    catalog:{},
    compiledStore:{},
    hydrate:vi.fn(async () => {}),
    getManifest:(...args)=>loader.getManifest?.(...args),
    hasAsset:()=>false,
    assertCompatibleManifest:vi.fn(),
    instantiate:(...args)=>loader.instantiate(...args),
    configureRenderer:(renderer)=>loader.configureRenderer(renderer)
  };
};

const physics = () => ({
  init:vi.fn(async () => {}),
  addEnvironment:vi.fn(),
  dispose:vi.fn(),
  step:vi.fn(() => false)
});

describe('WorldRuntime rendering boundary', () => {
  it('initializes headless without a DOM container or renderer', async () => {
    const assets = assetModule();
    const physicsSystem = physics();
    const runtime = new WorldRuntime({
      environmentFactory:environment,
      assetModule:assets,
      physicsFactory:() => physicsSystem,
      navigationBackendFactory:() => ({ dispose:vi.fn() })
    });

    expect(runtime.scene).toBeInstanceOf(THREE.Scene);
    expect(runtime.rendering).toBeNull();
    await runtime.init();

    expect(runtime.rendering).toBeNull();
    expect(assets.loader.configureRenderer).not.toHaveBeenCalled();

    runtime.dispose();
  });

  it('accepts one presentation adapter bound to the Runtime scene', async () => {
    const assets = assetModule();
    const physicsSystem = physics();
    const runtime = new WorldRuntime({
      environmentFactory:environment,
      assetModule:assets,
      physicsFactory:() => physicsSystem,
      navigationBackendFactory:() => ({ dispose:vi.fn() })
    });
    const renderer = {};
    const rendering = {
      scene:runtime.scene,
      renderer,
      init:vi.fn(async () => {}),
      applyEnvironment:vi.fn(),
      diagnostics:vi.fn(() => ({ backend:'test' })),
      resize:vi.fn(() => true),
      dispose:vi.fn()
    };

    expect(runtime.attachRendering(rendering)).toBe(rendering);
    await runtime.init();

    expect(rendering.init).toHaveBeenCalledOnce();
    expect(rendering.applyEnvironment).toHaveBeenCalledOnce();
    expect(assets.loader.configureRenderer).toHaveBeenCalledWith(renderer);
    expect(runtime.rendering.diagnostics()).toEqual({ backend:'test' });
    expect(runtime.rendering.resize()).toBe(true);

    expect(() => runtime.attachRendering({ ...rendering })).toThrow(/already attached/);
    runtime.dispose();
    expect(rendering.dispose).toHaveBeenCalledOnce();
  });
});
