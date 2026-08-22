import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { ObjectStore } from '../src/runtime/ObjectStore.js';
import { SpatialSystem } from '../src/runtime/systems/SpatialSystem.js';

function boxObject(size, position = [0,0,0]) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), new THREE.MeshBasicMaterial());
  mesh.position.fromArray(position);
  return mesh;
}

describe('SpatialSystem', () => {
  it('returns bounds and nearby objects', () => {
    const store = new ObjectStore();
    const a = boxObject([1,1,1], [0,0.5,0]); a.userData.instanceId = 'a';
    const b = boxObject([1,1,1], [1.5,0.5,0]); b.userData.instanceId = 'b';
    store.add('a', { id:'a', assetId:'box', object:a, manifest:{actions:[]} });
    store.add('b', { id:'b', assetId:'box', object:b, manifest:{actions:[]} });
    const spatial = new SpatialSystem({ store });
    expect(spatial.getBounds('a').size).toEqual([1,1,1]);
    expect(spatial.findNearby('a', 2)[0].id).toBe('b');
  });

  it('detects overlap', () => {
    const store = new ObjectStore();
    const a = boxObject([1,1,1], [0,0.5,0]); a.userData.instanceId = 'a';
    const b = boxObject([1,1,1], [0.3,0.5,0]); b.userData.instanceId = 'b';
    store.add('a', { id:'a', assetId:'box', object:a, manifest:{actions:[]} });
    store.add('b', { id:'b', assetId:'box', object:b, manifest:{actions:[]} });
    const spatial = new SpatialSystem({ store });
    expect(spatial.isColliding('a')).toContain('b');
  });

  it('finds collision-free support space on a surface', () => {
    const store = new ObjectStore();
    const table = boxObject([2.4,0.2,1.2], [0,1,0]); table.userData.instanceId = 'table';
    const cup = boxObject([0.3,0.3,0.3], [0,2,0]); cup.userData.instanceId = 'cup';
    const blocker = boxObject([0.5,0.5,0.5], [0,1.45,0]); blocker.userData.instanceId = 'blocker';
    store.add('table', { id:'table', assetId:'table', object:table, manifest:{actions:[], surfaces:[{id:'top', localPosition:[0,0.2,0], size:[2.2,1.0]}]} });
    store.add('cup', { id:'cup', assetId:'cup', object:cup, manifest:{actions:['place']} });
    store.add('blocker', { id:'blocker', assetId:'box', object:blocker, manifest:{actions:[]} });
    const spatial = new SpatialSystem({ store });
    const point = spatial.findFreeSpace('cup', 'table', { clearance: 0.02, grid: 5 });
    expect(point).not.toBeNull();
    expect(point.y).toBeCloseTo(1.37, 2);
    cup.position.copy(point);
    expect(spatial.isColliding('cup', { ignore:['table'] })).not.toContain('blocker');
  });
});
