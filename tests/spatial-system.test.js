import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { ObjectStore } from '../world/runtime/ObjectStore.js';
import { SpatialSystem } from '../world/runtime/systems/SpatialSystem.js';

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

  it('reuses one short-lived bounds snapshot across bounds and collision queries', () => {
    const store = new ObjectStore();
    const a = boxObject([1,1,1], [0,0.5,0]);
    const b = boxObject([1,1,1], [0.3,0.5,0]);
    store.add('a', { id:'a', assetId:'box', object:a, manifest:{actions:[]} });
    store.add('b', { id:'b', assetId:'box', object:b, manifest:{actions:[]} });
    const spatial = new SpatialSystem({ store });
    const aUpdate = vi.spyOn(a, 'updateWorldMatrix');
    const bUpdate = vi.spyOn(b, 'updateWorldMatrix');
    const snapshot = spatial.snapshot();

    expect(spatial.getBounds('a', snapshot).size).toEqual([1,1,1]);
    expect(spatial.isColliding('a', { snapshot })).toContain('b');
    expect(aUpdate).toHaveBeenCalledTimes(1);
    expect(bUpdate).toHaveBeenCalledTimes(1);
  });


  it('returns each collision pair once from a shared snapshot', () => {
    const store = new ObjectStore();
    const a = boxObject([1,1,1], [0,0.5,0]);
    const b = boxObject([1,1,1], [0.3,0.5,0]);
    const c = boxObject([1,1,1], [4,0.5,0]);
    for (const [id, object] of [['a',a],['b',b],['c',c]]) store.add(id, { id, assetId:'box', object, manifest:{actions:[]} });
    const spatial = new SpatialSystem({ store });
    expect(spatial.collisionPairs({ snapshot:spatial.snapshot() })).toEqual([['a','b']]);
  });

  it('reuses static-object bounds while searching multiple placement candidates', () => {
    const store = new ObjectStore();
    const table = boxObject([2.4,0.2,1.2], [0,1,0]);
    const cup = boxObject([0.3,0.3,0.3], [0,2,0]);
    const blocker = boxObject([0.5,0.5,0.5], [0,1.45,0]);
    store.add('table', { id:'table', assetId:'table', object:table, manifest:{actions:[], surfaces:[{id:'top', localPosition:[0,0.2,0], size:[2.2,1.0]}]} });
    store.add('cup', { id:'cup', assetId:'cup', object:cup, manifest:{actions:['place']} });
    store.add('blocker', { id:'blocker', assetId:'box', object:blocker, manifest:{actions:[]} });
    const spatial = new SpatialSystem({ store });
    const blockerUpdate = vi.spyOn(blocker, 'updateWorldMatrix');
    expect(spatial.findFreeSpace('cup', 'table', { clearance:0.02, grid:5 })).not.toBeNull();
    expect(blockerUpdate).toHaveBeenCalledTimes(1);
  });


  it('uses the same supportStatus geometry contract for ON verification', () => {
    const store=new ObjectStore(); const scene=new THREE.Scene();
    const table=new THREE.Group(); table.position.set(0,0,0); table.updateMatrixWorld(true); scene.add(table);
    const top=new THREE.Mesh(new THREE.BoxGeometry(2.2,.2,1)); top.position.y=1; table.add(top); table.updateMatrixWorld(true);
    store.add('table',{id:'table',assetId:'table',object:table,manifest:{actions:[],surfaces:[{id:'top',localPosition:[0,1.1,0],size:[2.2,1]}]}});
    const cup=new THREE.Mesh(new THREE.BoxGeometry(.2,.2,.2)); cup.position.set(0,1.2,0); cup.updateMatrixWorld(true); scene.add(cup);
    store.add('cup',{id:'cup',assetId:'cup',object:cup,manifest:{actions:[]}});
    const spatial=new SpatialSystem({store,scene});
    expect(spatial.supportStatus('cup','table',{surfaceId:'top'})).toMatchObject({on:true,surfaceId:'top',withinX:true,withinZ:true});
    cup.position.set(2,1.2,0); cup.updateMatrixWorld(true);
    expect(spatial.supportStatus('cup','table',{surfaceId:'top'}).on).toBe(false);
  });

  it('does not report ON when an object is slightly below the declared support surface', () => {
    const store=new ObjectStore(); const scene=new THREE.Scene();
    const table=new THREE.Group(); table.updateMatrixWorld(true); scene.add(table);
    const top=new THREE.Mesh(new THREE.BoxGeometry(2.2,.2,1)); top.position.set(0,1,0); table.add(top);
    table.updateMatrixWorld(true);
    store.add('table',{id:'table',assetId:'table',object:table,manifest:{actions:[],surfaces:[{id:'top',localPosition:[0,1.1,0],size:[2.2,1]}]}});
    const cup=new THREE.Mesh(new THREE.BoxGeometry(.2,.2,.2)); cup.position.set(0,1.15,0); cup.updateMatrixWorld(true); scene.add(cup);
    store.add('cup',{id:'cup',assetId:'cup',object:cup,manifest:{actions:[]}});
    const spatial=new SpatialSystem({store,scene});
    expect(spatial.supportStatus('cup','table',{surfaceId:'top'})).toMatchObject({on:false,aboveSurface:false,withinX:true,withinZ:true});
  });

});


it('uses declared receptacle volume for containment instead of treating the whole target AABB as storage',()=>{
  const store=new ObjectStore();
  const scene=new THREE.Scene();
  const cabinet=new THREE.Mesh(new THREE.BoxGeometry(2,2,2)); cabinet.position.set(0,1,0); scene.add(cabinet); cabinet.updateMatrixWorld(true);
  const item=new THREE.Mesh(new THREE.BoxGeometry(.2,.2,.2)); item.position.set(0,.5,0); scene.add(item); item.updateMatrixWorld(true);
  store.add('cabinet',{id:'cabinet',assetId:'cabinet',object:cabinet,manifest:{actions:[],receptacles:[{id:'interior',localPosition:[0,0,0],size:[1.4,1.4,1.4]}]}});
  store.add('item',{id:'item',assetId:'item',object:item,manifest:{actions:[]}});
  const spatial=new SpatialSystem({store,scene});
  expect(spatial.insideStatus('item','cabinet',{receptacleId:'interior'})).toMatchObject({inside:true,receptacleId:'interior',mode:'receptacle'});
  item.position.set(.9,.5,0); item.updateMatrixWorld(true);
  expect(spatial.insideStatus('item','cabinet',{receptacleId:'interior'})).toMatchObject({inside:false,reason:'OUTSIDE_RECEPTACLE'});
});
