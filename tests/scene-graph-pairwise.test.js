import * as THREE from 'three';
import { expect, it, vi } from 'vitest';
import { ObjectStore } from '../src/runtime/ObjectStore.js';
import { SpatialSystem } from '../src/runtime/systems/SpatialSystem.js';
import { SceneGraph } from '../src/runtime/graph/SceneGraph.js';

it('computes pair distance once while preserving directed NEAR relations', () => {
  const store = new ObjectStore();
  for (const [id, x] of [['a',0],['b',1],['c',5]]) {
    const object = new THREE.Mesh(new THREE.BoxGeometry(1,1,1), new THREE.MeshBasicMaterial());
    object.position.set(x, .5, 0);
    store.add(id, { id, assetId:'box', object, manifest:{actions:[]} });
  }
  const spatial = new SpatialSystem({ store });
  const snapshot = spatial.snapshot();
  const distanceSpies = [...snapshot.values()].map((entry) => vi.spyOn(entry.center, 'distanceTo'));
  const graph = new SceneGraph({ store, spatial });
  graph.update(snapshot);

  expect(distanceSpies.reduce((sum, spy) => sum + spy.mock.calls.length, 0)).toBe(3); // n*(n-1)/2
  expect(graph.list({ subject:'a', predicate:'NEAR', object:'b' })).toHaveLength(1);
  expect(graph.list({ subject:'b', predicate:'NEAR', object:'a' })).toHaveLength(1);
});
