import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { SceneSerializer } from '../src/persistence/SceneSerializer.js';
import { ObjectStore } from '../src/runtime/ObjectStore.js';

function fakeRuntime() {
  const store = new ObjectStore();
  const object = new THREE.Group();
  object.position.set(1, 2, 3);
  object.quaternion.setFromEuler(new THREE.Euler(0, 0.5, 0));
  object.scale.set(1, 1, 1);
  store.add('cabinet_01', {
    id: 'cabinet_01', assetId: 'cabinet', object,
    manifest: { id: 'cabinet', type: 'cabinet', source: { kind: 'glb', url: 'assets/cabinet.glb' }, actions: ['open'] },
    state: { door: 'open' }
  });
  return {
    version: '0.8.0', store,
    assets: { getManifest: vi.fn(() => ({ id: 'cabinet', type: 'cabinet', source: { kind: 'glb', url: 'assets/cabinet.glb' }, actions: ['open'] })) },
    camera: { position: new THREE.Vector3(4,5,6) },
    controls: { target: new THREE.Vector3(0,1,0) }
  };
}

describe('SceneSerializer', () => {
  it('serializes versioned scene data including dynamic manifests and state', () => {
    const scene = new SceneSerializer().serialize(fakeRuntime(), { name: 'Test' });
    expect(scene.schema).toBe('agentscape.scene');
    expect(scene.schemaVersion).toBe(1);
    expect(scene.objects[0]).toMatchObject({ id: 'cabinet_01', assetId: 'cabinet', state: { door: 'open' } });
    expect(scene.assets[0].id).toBe('cabinet');
  });

  it('rejects unknown scene versions', () => {
    const serializer = new SceneSerializer();
    expect(() => serializer.validate({ schema: 'agentscape.scene', schemaVersion: 99, objects: [], assets: [] })).toThrow(/version/);
  });

  it('preflights unknown asset references before clearing the current world', async () => {
    const serializer = new SceneSerializer();
    const runtime = {
      assets: {
        assertCompatibleManifest: vi.fn(),
        has: vi.fn(() => false)
      },
      clearObjects: vi.fn(),
      sceneGraph: { batch: vi.fn(async (operation) => operation()) }
    };
    const scene = {
      schema: 'agentscape.scene', schemaVersion: 1, assets: [], relations: [],
      objects: [{ id:'missing_01', assetId:'missing', transform:{ position:[0,0,0], quaternion:[0,0,0,1], scale:[1,1,1] } }]
    };

    await expect(serializer.restore(runtime, scene)).rejects.toThrow(/unknown asset/i);
    expect(runtime.clearObjects).not.toHaveBeenCalled();
    expect(runtime.sceneGraph.batch).not.toHaveBeenCalled();
  });

  it('preflights manifest conflicts before clearing the current world', async () => {
    const serializer = new SceneSerializer();
    const runtime = {
      assets: {
        assertCompatibleManifest: vi.fn(() => { throw new Error('Asset id conflict: chair'); }),
        has: vi.fn(() => true)
      },
      clearObjects: vi.fn(),
      sceneGraph: { batch: vi.fn(async (operation) => operation()) }
    };
    const scene = {
      schema: 'agentscape.scene', schemaVersion: 1,
      assets: [{ id:'chair', type:'chair', source:{kind:'glb',url:'chair.glb'}, actions:['move'] }], relations: [], objects: []
    };

    await expect(serializer.restore(runtime, scene)).rejects.toThrow(/conflict/i);
    expect(runtime.clearObjects).not.toHaveBeenCalled();
    expect(runtime.sceneGraph.batch).not.toHaveBeenCalled();
  });

});
