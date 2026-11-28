import * as THREE from 'three';
import { expect, it, vi } from 'vitest';
import { ObjectStore } from '../../modules/world/runtime/ObjectStore.js';
import { SpatialSystem } from '../../modules/world/runtime/systems/SpatialSystem.js';
import { SceneGraph } from '../../modules/world/runtime/graph/SceneGraph.js';

it('computes pair distance once while preserving directed NEAR relations', () => {
  const store = new ObjectStore();
  for (const [id, x] of [['b',1],['a',-1],['c',50]]) {
    const object = new THREE.Mesh(new THREE.BoxGeometry(1,1,1), new THREE.MeshBasicMaterial());
    object.position.set(x, .5, 0);
    store.add(id, { id, assetId:'box', object, manifest:{actions:[]} });
  }
  const spatial = new SpatialSystem({ store });
  const snapshot = spatial.snapshot();
  const distanceSpies = [...snapshot.values()].map((entry) => vi.spyOn(entry.center, 'distanceTo'));
  const graph = new SceneGraph({ store, spatial });
  graph.update(snapshot);

  expect(distanceSpies.reduce((sum, spy) => sum + spy.mock.calls.length, 0)).toBe(1);
  expect(graph.list({ subject:'a', predicate:'NEAR', object:'b' })).toHaveLength(1);
  expect(graph.list({ subject:'b', predicate:'NEAR', object:'a' })).toHaveLength(1);
});

it.each([10, 0.8, 0.05])('matches a fresh graph after moving one object at spacing %s', (spacing) => {
  const store = new ObjectStore();
  for (let i = 0; i < 12; i++) {
    const id = String(i);
    const object = new THREE.Mesh(new THREE.BoxGeometry(.1,.1,.1));
    object.position.x = i * spacing;
    store.add(id, { id, object, manifest:{actions:[]} });
  }
  const spatial = new SpatialSystem({store});
  const graph = new SceneGraph({store, spatial});
  graph.update();
  for (const x of [1.2, 50, -1]) {
    store.get('5').object.position.x = x;
    const snapshot = spatial.snapshot();
    const spies = [...snapshot].filter(([id]) => id !== '5')
      .map(([,entry]) => vi.spyOn(entry.center, 'distanceTo'));
    graph.invalidate();
    graph.update(snapshot);
    expect(spies.every(spy => spy.mock.calls.length === 0)).toBe(true);
    const fresh = new SceneGraph({store, spatial});
    fresh.update(snapshot);
    expect(graph.edges).toEqual(fresh.edges);
  }
});
