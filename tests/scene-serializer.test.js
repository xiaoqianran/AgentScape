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
});
