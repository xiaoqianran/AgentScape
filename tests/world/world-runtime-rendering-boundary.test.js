import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { WorldRuntime } from '../../modules/world/runtime/WorldRuntime.js';

const environment = () => {
  const root = new THREE.Group();
  const floor = new THREE.Mesh(new THREE.BoxGeometry(4, 0.2, 4), new THREE.MeshBasicMaterial());
  root.add(floor);
  return { id:'headless-world', root, floor, colliders:[], dispose:vi.fn() };
};

const assetModule = () => ({
  registry:{ getManifest:vi.fn(), has:vi.fn(() => false) },
  loader:{ instantiate:vi.fn(), configureRenderer:vi.fn() },
  catalog:{},
  compiledStore:{},
  hydrate:vi.fn(async () => {})
});

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
    expect(runtime.renderingDiagnostics()).toBeNull();
    expect(runtime.resize()).toBe(false);
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
    expect(runtime.renderingDiagnostics()).toEqual({ backend:'test' });

    expect(() => runtime.attachRendering({ ...rendering })).toThrow(/already attached/);
    runtime.dispose();
    expect(rendering.dispose).toHaveBeenCalledOnce();
  });
});
