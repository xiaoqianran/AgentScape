import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { ObjectStore } from '../../world/runtime/ObjectStore.js';
import { EventBus } from '../../core/EventBus.js';
import { createRecastNavigationSystem } from '../helpers/createRecastNavigationSystem.js';

const floor = () => {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(10, .2, 8));
  mesh.position.y = -.1;
  mesh.updateMatrixWorld(true);
  return mesh;
};

const wall = ({ z = 0, depth = 4 } = {}) => {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(.4, 2, depth));
  mesh.position.set(0, 1, z);
  mesh.updateMatrixWorld(true);
  return mesh;
};

const addRecord = (store, id, object, body) => {
  const record = { id, assetId:id, object, manifest:{ physics:{ body } }, state:{} };
  store.add(id, record);
  return record;
};

describe('NavigationSystem', () => {
  it('builds one lazy Recast NavMesh and finds a Detour path around fixed geometry', async () => {
    const store = new ObjectStore();
    addRecord(store, 'wall', wall(), 'fixed');
    const navigation = createRecastNavigationSystem({ store, environmentRoots:[floor()] });

    const [path, reachability] = await Promise.all([
      navigation.findPath([-4,0,0], [4,0,0]),
      navigation.canReach([-4,0,-3], [4,0,-3])
    ]);

    expect(path.reachable).toBe(true);
    expect(path.sameIsland).toBe(true);
    expect(path.path.length).toBeGreaterThan(2);
    expect(path.cost).toBeGreaterThan(8);
    expect(path.path.some((point) => Math.abs(point[2]) > 2)).toBe(true);
    expect(reachability.reachable).toBe(true);
    expect(reachability).not.toHaveProperty('path');
    expect(reachability.waypointCount).toBeGreaterThan(1);
    expect(navigation.status()).toMatchObject({ state:'ready', dirty:false, buildVersion:1 });
    expect(navigation.status().lastBuild.meshCount).toBe(2);
    navigation.dispose();
  }, 15000);

  it('reports a disconnected static world as unreachable instead of confusing it with free space', async () => {
    const store = new ObjectStore();
    addRecord(store, 'barrier', wall({ depth:8 }), 'fixed');
    const navigation = createRecastNavigationSystem({ store, environmentRoots:[floor()] });
    const result = await navigation.findPath([-4,0,0], [4,0,0]);

    expect(result.reachable).toBe(false);
    expect(['PARTIAL_PATH','NO_PATH']).toContain(result.reason);
    if (result.reason === 'PARTIAL_PATH') expect(result.sameIsland).toBe(false);
    navigation.dispose();
  }, 15000);

  it('ignores dynamic geometry in the static NavMesh and only fixed records invalidate it', async () => {
    const store = new ObjectStore();
    const dynamic = addRecord(store, 'dynamic_wall', wall({ depth:8 }), 'dynamic');
    const fixed = addRecord(store, 'fixed_box', wall({ z:20, depth:1 }), 'fixed');
    // Keep the fixed object outside the floor bounds so it does not affect this path.
    const navigation = createRecastNavigationSystem({ store, environmentRoots:[floor()] });
    const result = await navigation.findPath([-4,0,0], [4,0,0]);

    expect(result.reachable).toBe(true);
    expect(navigation.status().lastBuild.meshCount).toBe(2); // floor + fixed_box, dynamic wall ignored.
    expect(navigation.invalidateIfStatic(dynamic, 'dynamic-moved')).toBe(false);
    expect(navigation.status().dirty).toBe(false);
    expect(navigation.invalidateIfStatic(fixed, 'fixed-moved')).toBe(true);
    expect(navigation.status()).toMatchObject({ state:'dirty', dirty:true, lastInvalidation:'fixed-moved' });
    navigation.dispose();
  }, 15000);

  it('distinguishes an off-navmesh endpoint from a disconnected path', async () => {
    const navigation = createRecastNavigationSystem({ store:new ObjectStore(), environmentRoots:[floor()] });
    const result = await navigation.findPath([0,0,0], [100,0,100], { maxSnapDistance:.5 });
    expect(result).toMatchObject({ reachable:false, reason:'END_OFF_NAVMESH', sameIsland:null, path:[] });
    navigation.dispose();
  }, 15000);

  it('excludes executable Part subtrees from the static NavMesh geometry', async () => {
    const store = new ObjectStore();
    const root = new THREE.Group();
    const body = wall({ z:20, depth:1 }); body.name='Body'; root.add(body);
    const door = new THREE.Group(); door.name='DoorPart';
    const panel = wall({ depth:8 }); panel.name='DoorPanel'; door.add(panel); root.add(door);
    root.updateMatrixWorld(true);
    store.add('cabinet', {
      id:'cabinet', assetId:'cabinet', object:root,
      manifest:{ physics:{body:'fixed'}, parts:{door:{node:'DoorPart',physics:{body:'dynamic'},joint:{type:'revolute'}}} }, state:{}
    });
    const navigation = createRecastNavigationSystem({ store, environmentRoots:[floor()] });
    const result = await navigation.findPath([-4,0,0], [4,0,0]);
    expect(result.reachable).toBe(true);
    expect(result.scope).toBe('static');
    expect(navigation.status().capabilities.dynamicObstacles).toBe(false);
    expect(navigation.status().lastBuild.skipped).toContainEqual(expect.objectContaining({node:'DoorPanel',reason:'dynamic-part'}));
    navigation.dispose();
  }, 15000);



  it('reports dynamic obstacle capability from the injected physics backend instead of assuming Rapier', () => {
    const renderOnly = createRecastNavigationSystem({
      store:new ObjectStore(),
      physics:{hasCapability:(name)=>name==='transform-state',profile:()=>({identity:'transform'})},
      environmentRoots:[]
    });
    expect(renderOnly.status().capabilities).toMatchObject({dynamicObstacles:false,obstacleSource:'none'});
    renderOnly.dispose();

    const solver = createRecastNavigationSystem({
      store:new ObjectStore(),
      physics:{hasCapability:(name)=>name==='collision',profile:()=>({identity:'rapier'})},
      environmentRoots:[]
    });
    expect(solver.status().capabilities).toMatchObject({dynamicObstacles:true,obstacleSource:'physics:rapier:colliders'});
    solver.dispose();
  });

  it('owns interaction invalidation and unsubscribes on dispose', async () => {
    const store=new ObjectStore();
    const fixed=addRecord(store,'fixed',wall({z:20,depth:1}),'fixed');
    const dynamic=addRecord(store,'dynamic',wall({z:20,depth:1}),'dynamic');
    const events=new EventBus();
    const navigation=createRecastNavigationSystem({store,environmentRoots:[floor()],events});
    await navigation.findPath([-4,0,0],[4,0,0]);
    events.emit('interaction',{action:'move',id:dynamic.id});
    expect(navigation.status().dirty).toBe(false);
    events.emit('interaction',{action:'move',id:fixed.id});
    expect(navigation.status()).toMatchObject({dirty:true,lastInvalidation:'interaction:move'});
    navigation.dispose();
    expect((await navigation.canReach([0,0,0],[1,0,0])).reason).toBe('NAVIGATION_DISPOSED');
  },15000);

});
