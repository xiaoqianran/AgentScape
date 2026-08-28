import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { ObjectStore } from '../src/runtime/ObjectStore.js';
import { createRecastNavigationSystem } from './helpers/createRecastNavigationSystem.js';

const floor = () => {
  const mesh=new THREE.Mesh(new THREE.BoxGeometry(10,.2,8));
  mesh.position.y=-.1; mesh.updateMatrixWorld(true); return mesh;
};

const barrier = (z=0) => ({
  id:'crate:$root:0', objectId:'crate', part:'$root', collider:0,
  shape:'box', sourceShape:'box', quality:'exact-yaw',
  position:[0,1,z], halfExtents:[.25,1,4], angle:0
});

describe('NavigationSystem dynamic obstacles',()=>{
  it('updates TileCache from current physics obstacles without rebuilding the static NavMesh',async()=>{
    let items=[barrier(0)];
    const physics={navigationObstacles:()=>({items:structuredClone(items),skipped:[]})};
    const navigation=createRecastNavigationSystem({store:new ObjectStore(),physics,environmentRoots:[floor()]});

    const blocked=await navigation.findPath([-4,0,0],[4,0,0]);
    expect(blocked).toMatchObject({reachable:false,scope:'current',reason:'PARTIAL_PATH',buildVersion:1});
    expect(blocked.dynamicObstacles).toMatchObject({coverage:'complete',tracked:1,changed:1,syncVersion:1});

    items=[barrier(20)];
    const clear=await navigation.findPath([-4,0,0],[4,0,0]);
    expect(clear).toMatchObject({reachable:true,scope:'current',buildVersion:1});
    expect(clear.dynamicObstacles).toMatchObject({tracked:1,changed:1,operations:2,syncVersion:2});
    expect(navigation.status().buildVersion).toBe(1);

    items=[];
    const removed=await navigation.canReach([-4,0,0],[4,0,0]);
    expect(removed.reachable).toBe(true);
    expect(removed.dynamicObstacles).toMatchObject({tracked:0,changed:1,operations:1,syncVersion:3});
    expect(navigation.status().buildVersion).toBe(1);
    navigation.dispose();
  },15000);

  it('reports partial dynamic coverage when PhysicsSystem skips an unsupported collider',async()=>{
    const physics={navigationObstacles:()=>({items:[],skipped:[{id:'x:$root:0',reason:'unsupported-shape',shapeType:99}]})};
    const navigation=createRecastNavigationSystem({store:new ObjectStore(),physics,environmentRoots:[floor()]});
    const result=await navigation.findPath([-4,0,0],[4,0,0]);
    expect(result.reachable).toBe(true);
    expect(result.scope).toBe('current');
    expect(result.dynamicObstacles).toMatchObject({coverage:'partial',tracked:0});
    expect(result.dynamicObstacles.skipped[0].reason).toBe('unsupported-shape');
    navigation.dispose();
  },15000);

  it('drains TileCache requests in batches before the upstream 64-request queue overflows',async()=>{
    const items=Array.from({length:70},(_,i)=>({
      id:`o${i}:$root:0`,objectId:`o${i}`,part:'$root',collider:0,
      shape:'cylinder',sourceShape:'cylinder',quality:'exact-upright',
      position:[-4+(i%14)*.6,0,-3+Math.floor(i/14)*1.2],radius:.05,height:.5
    }));
    const physics={navigationObstacles:()=>({items,skipped:[]})};
    const navigation=createRecastNavigationSystem({store:new ObjectStore(),physics,environmentRoots:[floor()],backendOptions:{maxObstacles:96}});
    const result=await navigation.findPath([-4,0,3],[4,0,3]);
    expect(result.dynamicObstacles).toMatchObject({coverage:'complete',tracked:70,changed:70,operations:70});
    expect(result.dynamicObstacles.updates).toBeGreaterThan(1);
    expect(navigation.status().buildVersion).toBe(1);
    navigation.dispose();
  },15000);

});
