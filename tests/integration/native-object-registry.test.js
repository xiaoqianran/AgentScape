import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { NativeObjectRegistry } from '../../application/native-scene/NativeObjectRegistry.js';
import { attachNativeScene } from '../../application/native-scene/NativeSceneHost.js';

const renderer = () => ({ render: vi.fn(), dispose: vi.fn(), extensions: { has: () => false } });

describe('NativeObjectRegistry', () => {
  it('keeps references to host objects without adopting their resources', () => {
    const scene = new THREE.Scene();
    const object = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
    object.position.set(2, 3, 4);
    scene.add(object);
    const geometryDispose = vi.spyOn(object.geometry, 'dispose');
    const registry = new NativeObjectRegistry(scene);
    expect(registry.registerObject({ id: 'native:lamp', object, label: 'Lamp' }))
      .toMatchObject({ id: 'native:lamp', position: [2, 3, 4], interactive: false });
    expect(() => registry.registerObject({ id: 'same', object })).toThrow('NATIVE_OBJECT_ALREADY_REGISTERED');
    expect(() => registry.registerObject({ id: 'invalid id', object })).toThrow('NATIVE_OBJECT_ID_INVALID');
    expect(() => registry.registerObject({ id: 'foreign', object: new THREE.Group() }))
      .toThrow('NATIVE_OBJECT_NOT_IN_HOST');
    const addedRoot = new THREE.Group();
    registry.setManagedRoot(addedRoot);
    scene.add(addedRoot);
    const managed = new THREE.Mesh();
    addedRoot.add(managed);
    expect(() => registry.registerObject({ id: 'managed', object: managed }))
      .toThrow('NATIVE_OBJECT_NOT_IN_HOST');

    scene.remove(object);
    expect(registry.listObjects()).toEqual([]);
    expect(geometryDispose).not.toHaveBeenCalled();
    registry.close();
    expect(() => registry.registerObject({ id: 'again', object })).toThrow('NATIVE_OBJECT_REGISTRY_CLOSED');
    expect(geometryDispose).not.toHaveBeenCalled();
    object.geometry.dispose();
    object.material.dispose();
  });

  it('makes registered host interactions observable and executable without entering ObjectStore', async () => {
    const scene = new THREE.Scene();
    const floor = new THREE.Mesh(new THREE.BoxGeometry(16, 0.2, 16), new THREE.MeshBasicMaterial());
    floor.position.y = -0.1;
    const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.2, 0.2), new THREE.MeshBasicMaterial());
    lamp.position.set(0.2, 0.8, 0);
    scene.add(floor, lamp);
    const disposeLamp = vi.spyOn(lamp.geometry, 'dispose');
    const session = await attachNativeScene({
      scene, camera: new THREE.PerspectiveCamera(), renderer: renderer(), autoStart: false,
      walkableMesh: floor,
      nativeObjects: [{ id: 'native:lamp', object: lamp, label: 'Desk lamp', activate: () => { lamp.visible = !lamp.visible; } }]
    });
    try {
      const native = session.scene.native;
      expect(session.scene.capabilities.nativeObjectRegistration).toBe(true);
      expect(native.listObjects()).toMatchObject([{ id: 'native:lamp', interactive: true }]);
      expect(session.world.store.has('native:lamp')).toBe(false);
      expect(session.scene.observe().nativeObjects).toHaveLength(1);
      expect(session.scene.observe().nativeInteractions.items).toMatchObject([{ id: 'native:lamp' }]);
      await session.scene.addModel({ id: 'walker', asset: 'builtin://agent', position: [0, 0, 0] });
      const job = session.scene.interact({ action: 'activate', actor: 'walker', target: 'native:lamp' });
      const result = await session.scene.waitJob(job.id);
      expect(result.status).toBe('succeeded');
      expect(result.result.verification.status).toBe('unverified');
      expect(lamp.visible).toBe(false);

      const decor = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
      scene.add(decor);
      expect(native.registerObject({ id: 'native:decor', object: decor })).toMatchObject({ interactive: false });
      expect(session.scene.observe().nativeObjects).toHaveLength(2);
      expect(native.unregisterObject('native:lamp')).toBe(true);
      expect(session.scene.observe().nativeInteractions.items).toHaveLength(0);
      expect(native.unregisterObject('native:lamp')).toBe(false);
      scene.remove(decor);
      expect(native.listObjects()).toHaveLength(0);
      decor.geometry.dispose();
      decor.material.dispose();
    } finally {
      session.close();
    }
    expect(scene.children).toEqual([floor, lamp]);
    expect(disposeLamp).not.toHaveBeenCalled();
    lamp.geometry.dispose(); lamp.material.dispose(); floor.geometry.dispose(); floor.material.dispose();
  }, 30000);
});
