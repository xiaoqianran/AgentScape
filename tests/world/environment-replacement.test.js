import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { createAssetModule } from '../../generation/orchestration/createAssetModule.js';
import { WorldRuntime } from '../../world/runtime/WorldRuntime.js';
import { SceneGraph } from '../../world/runtime/graph/SceneGraph.js';
import { SpatialSystem } from '../../world/runtime/systems/SpatialSystem.js';
import { createRapierPhysicsSystem } from '../helpers/createRapierPhysicsSystem.js';

const makeEnvironment=({id,label,wall=false}={})=>{
  const root=new THREE.Group(); root.name=`${id}-root`;
  const floor=new THREE.Mesh(new THREE.PlaneGeometry(8,8),new THREE.MeshBasicMaterial());
  floor.rotation.x=-Math.PI/2; floor.updateMatrixWorld(true); root.add(floor); root.updateMatrixWorld(true);
  return {
    id,root,floor,navigationRoot:root,
    colliders:[
      {shape:'box',halfExtents:[4,.1,4],translation:[0,-.1,0]},
      ...(wall?[{shape:'box',halfExtents:[.45,.5,.45],translation:[2,.5,2]}]:[])
    ],
    layout:{bounds:{min:[-4,-4],max:[4,4]},groundY:0,margin:.5},
    semantics:{schemaVersion:2,categories:[label],instances:[{id:`${label}-1`,label,confidence:.9,localization:{kind:'point-scale',center:[0,0,0],scale:.5}}]},
    dispose:vi.fn(()=>{floor.geometry.dispose();floor.material.dispose();})
  };
};

async function runtimeFixture(){
  const runtime=new WorldRuntime({appendChild(){}},{environmentFactory:()=>null,assetModule:createAssetModule(),physicsFactory:createRapierPhysicsSystem});
  runtime.scene=new THREE.Scene();
  await runtime.physics.init();
  runtime.rendering={applyEnvironment:vi.fn()};
  runtime.spatial=new SpatialSystem({store:runtime.store,scene:runtime.scene});
  runtime.sceneGraph=new SceneGraph({store:runtime.store,spatial:runtime.spatial,events:runtime.events});
  return runtime;
}

describe('WorldRuntime environment replacement',()=>{
  it('atomically switches SceneGraph, Rapier and Recast environment truth while ObjectStore is empty',async()=>{
    const runtime=await runtimeFixture();
    const first=makeEnvironment({id:'first',label:'door'});
    const second=makeEnvironment({id:'second',label:'bench',wall:true});
    runtime.installEnvironment(first); runtime.createEnvironmentSystems();

    expect(runtime.sceneGraph.list({predicate:'HAS_INSTANCE'})).toMatchObject([{object:'semantic-instance:door-1'}]);
    const cup=runtime.assets.getManifest('cup');
    expect(runtime.physics.manifestPoseClear(cup,[2,.01,2])).toMatchObject({checked:true,clear:true});

    const result=await runtime.replaceEnvironment(second,{disposePrevious:false,reason:'test'});
    expect(result).toMatchObject({status:'environment-ready',environmentId:'second',previousEnvironmentId:'first'});
    expect(runtime.environment).toBe(second);
    expect(runtime.scene.children).toContain(second.root);
    expect(runtime.scene.children).not.toContain(first.root);
    expect(first.dispose).not.toHaveBeenCalled();
    expect(runtime.sceneGraph.list({predicate:'HAS_INSTANCE'})).toMatchObject([{object:'semantic-instance:bench-1'}]);
    expect(runtime.physics.manifestPoseClear(cup,[2,.01,2])).toMatchObject({checked:true,clear:false,blockedBy:['environment:second']});
    expect(runtime.navigation.environmentRoots).toEqual([second.root]);
    const route=await runtime.navigation.findPath([-2,0,-2],[2,0,-2]);
    expect(route.reachable).toBe(true);
    runtime.navigation.dispose(); runtime.physics.dispose(); second.dispose(); first.dispose();
  },30000);

  it('fails closed instead of replacing the environment while executable objects still exist',async()=>{
    const runtime=await runtimeFixture();
    const first=makeEnvironment({id:'first',label:'door'}),second=makeEnvironment({id:'second',label:'bench'});
    runtime.installEnvironment(first); runtime.createEnvironmentSystems();
    await runtime.spawn('cup',{id:'cup_01',position:[0,.5,0]});
    await expect(runtime.replaceEnvironment(second)).rejects.toMatchObject({code:'ENVIRONMENT_REPLACE_REQUIRES_EMPTY_WORLD'});
    expect(runtime.environment).toBe(first);
    expect(runtime.store.has('cup_01')).toBe(true);
    runtime.remove('cup_01',{silent:true}); runtime.navigation.dispose(); runtime.physics.dispose(); first.dispose(); second.dispose();
  });
});
