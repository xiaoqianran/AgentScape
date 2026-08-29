import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { ObjectStore } from '../world/runtime/ObjectStore.js';
import { SpatialSystem } from '../world/runtime/systems/SpatialSystem.js';
import { SceneGraph } from '../world/runtime/graph/SceneGraph.js';

function mesh(size, position, id) {
  const object = new THREE.Mesh(new THREE.BoxGeometry(...size), new THREE.MeshBasicMaterial());
  object.position.fromArray(position);
  object.userData.instanceId = id;
  object.updateMatrixWorld(true);
  return object;
}

describe('SceneGraph', () => {
  it('derives ON, SUPPORTS and NEAR from world geometry', () => {
    const store = new ObjectStore();
    const table = mesh([2, .2, 1], [0, 1, 0], 'table');
    const cup = mesh([.3, .3, .3], [0, 1.25, 0], 'cup');
    store.add('table', { id:'table', assetId:'table', object:table, manifest:{ actions:[], surfaces:[{ id:'top', localPosition:[0,.1,0], size:[2,1] }] } });
    store.add('cup', { id:'cup', assetId:'cup', object:cup, manifest:{ actions:[] } });
    const spatial = new SpatialSystem({ store });
    spatial.snapshot ||= () => { const real = new SpatialSystem({ store }); return real.snapshot(); };
    const graph = new SceneGraph({ store, spatial });
    graph.update();
    expect(graph.list({ subject:'cup', predicate:'ON', object:'table' })).toHaveLength(1);
    expect(graph.list({ subject:'table', predicate:'SUPPORTS', object:'cup' })).toHaveLength(1);
    expect(graph.list({ subject:'cup', predicate:'NEAR', object:'table' })).toHaveLength(1);
  });

  it('derives INSIDE and CONTAINS', () => {
    const store = new ObjectStore();
    const container = mesh([2,2,2], [0,1,0], 'container');
    const item = mesh([.2,.2,.2], [0,1,0], 'item');
    store.add('container', { id:'container', assetId:'box', object:container, manifest:{ actions:[] } });
    store.add('item', { id:'item', assetId:'item', object:item, manifest:{ actions:[] } });
    const graph = new SceneGraph({ store, spatial:new SpatialSystem({ store }) });
    graph.update();
    expect(graph.list({ subject:'item', predicate:'INSIDE', object:'container' })).toHaveLength(1);
    expect(graph.list({ subject:'container', predicate:'CONTAINS', object:'item' })).toHaveLength(1);
  });

  it('removes stale edges when an object disappears', () => {
    const store = new ObjectStore();
    const a = mesh([1,1,1], [0,0,0], 'a');
    const b = mesh([1,1,1], [1,0,0], 'b');
    store.add('a', { id:'a', assetId:'a', object:a, manifest:{ actions:[] } });
    store.add('b', { id:'b', assetId:'b', object:b, manifest:{ actions:[] } });
    const graph = new SceneGraph({ store, spatial:new SpatialSystem({ store }) });
    graph.update();
    store.delete('b'); graph.removeObject('b'); graph.update();
    expect(graph.list().some(e => e.subject === 'b' || e.object === 'b')).toBe(false);
  });

  it('coalesces repeated and nested updates into one rebuild at the batch boundary', async () => {
    const store = new ObjectStore();
    const object = mesh([1,1,1], [0,0,0], 'a');
    store.add('a', { id:'a', assetId:'a', object, manifest:{ actions:[] } });
    const spatial = new SpatialSystem({ store });
    const snapshot = vi.spyOn(spatial, 'snapshot');
    const graph = new SceneGraph({ store, spatial });

    await graph.batch(async () => {
      graph.changed();
      graph.changed();
      await graph.batch(async () => {
        graph.changed();
        graph.changed();
      });
    });

    expect(snapshot).toHaveBeenCalledTimes(1);
    expect(graph.batchDepth).toBe(0);
    expect(graph.dirty).toBe(false);
  });


  it('refreshes immediately inside a batch when a reader explicitly requests current relations', async () => {
    const store = new ObjectStore();
    const object = mesh([1,1,1], [0,0,0], 'a');
    store.add('a', { id:'a', assetId:'a', object, manifest:{ actions:[] } });
    const spatial = new SpatialSystem({ store });
    const snapshot = vi.spyOn(spatial, 'snapshot');
    const graph = new SceneGraph({ store, spatial });
    await graph.batch(async () => {
      graph.changed();
      graph.update();
      expect(snapshot).toHaveBeenCalledTimes(1);
      graph.changed();
    });
    expect(snapshot).toHaveBeenCalledTimes(2);
  });

});
