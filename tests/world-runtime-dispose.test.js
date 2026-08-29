import * as THREE from 'three';
import { expect, it, vi } from 'vitest';
import { WorldRuntime } from '../world/runtime/WorldRuntime.js';

it('disposes objects without rebuilding semantic relations during teardown', () => {
  const object = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
  const store = new Map([['a', { object }]]);
  const runtime = {
    running:true,
    _resize:()=>{},
    store:{ list:()=>[...store], delete:(id)=>store.delete(id) },
    physics:{ remove:vi.fn(), dispose:vi.fn() },
    navigation:{ dispose:vi.fn() },
    interactions:{ cancelPending:vi.fn() },
    scene:{ remove:vi.fn(), traverse:(fn)=>{} },
    sceneGraph:{ reset:vi.fn(), update:vi.fn() },
    controls:{ dispose:vi.fn() },
    renderer:{ dispose:vi.fn(), domElement:{ remove:vi.fn() } },
    events:{ clear:vi.fn() }
  };
  const navigationDispose = runtime.navigation.dispose;
  const oldWindow = globalThis.window;
  globalThis.window = { removeEventListener:vi.fn() };
  try { WorldRuntime.prototype.dispose.call(runtime); }
  finally { globalThis.window = oldWindow; }
  expect(runtime.interactions.cancelPending).toHaveBeenCalledWith('RUNTIME_DISPOSED');
  expect(runtime.sceneGraph.reset).toHaveBeenCalledOnce();
  expect(runtime.sceneGraph.update).not.toHaveBeenCalled();
  expect(runtime.physics.dispose).toHaveBeenCalledOnce();
  expect(navigationDispose).toHaveBeenCalledOnce();
  expect(runtime.navigation).toBeNull();
});
