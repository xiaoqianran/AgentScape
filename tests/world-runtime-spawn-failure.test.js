import * as THREE from 'three';
import { expect, it, vi } from 'vitest';
import { WorldRuntime } from '../src/runtime/WorldRuntime.js';

it('rolls back Three/store resources when physics attachment fails', async () => {
  const geometry = new THREE.BoxGeometry(); geometry.dispose = vi.fn();
  const material = new THREE.MeshStandardMaterial(); material.dispose = vi.fn();
  const object = new THREE.Mesh(geometry, material);
  const runtime = {
    assets:{ instantiate:vi.fn(async () => ({ object, manifest:{ id:'x', actions:['move'] } })) },
    scene:{ add:vi.fn(), remove:vi.fn() },
    store:{ add:vi.fn(), delete:vi.fn() },
    physics:{ attach:vi.fn(() => { throw new Error('physics failed'); }), remove:vi.fn() },
    sceneGraph:{ update:vi.fn() }, events:{ emit:vi.fn() }
  };

  await expect(WorldRuntime.prototype.spawn.call(runtime, 'x', { id:'x_1' })).rejects.toThrow('physics failed');
  expect(runtime.store.delete).toHaveBeenCalledWith('x_1');
  expect(runtime.scene.remove).toHaveBeenCalledWith(object);
  expect(geometry.dispose).toHaveBeenCalledOnce();
  expect(material.dispose).toHaveBeenCalledOnce();
});
