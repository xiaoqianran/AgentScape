import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { ObjectStore } from '../src/runtime/ObjectStore.js';
import { PhysicsBackend, TransformPhysicsBackend } from '../src/runtime/physics/PhysicsBackend.js';
import { PhysicsSystem } from '../src/runtime/systems/PhysicsSystem.js';
import { RapierPhysicsBackend } from '../src/runtime/physics/RapierPhysicsBackend.js';

describe('PhysicsBackend contract',()=>{
  it('requires an explicit backend at the runtime state-owner boundary',()=>{
    expect(()=>new PhysicsSystem()).toThrow(/requires a physics backend/);
  });
  it('declares the minimum backend boundary without exposing a concrete solver contract',()=>{
    const backend=new PhysicsBackend('test',['rigid-body']);
    expect(backend.identity).toBe('test'); expect(backend.hasCapability('rigid-body')).toBe(true); expect(backend.hasCapability('soft-body')).toBe(false); expect(backend.supportsExecutionMode('realtime')).toBe(true);
    expect(()=>backend.createWorld()).toThrow(/must be implemented/);
  });
  it('Rapier backend satisfies capability and lifecycle parity',async()=>{
    const backend=new RapierPhysicsBackend(); await backend.init(); const world=backend.createWorld();
    expect(backend.identity).toBe('rapier');
    expect(backend.hasCapability('transform-state')).toBe(false);
    expect(backend.hasCapability('rigid-body')).toBe(true);
    expect(backend.hasCapability('articulated-body')).toBe(true);
    expect(backend.hasCapability('character-controller')).toBe(true);
    expect(backend.hasCapability('snapshot-restore')).toBe(false);
    expect(backend.hasCapability('counterfactual-query')).toBe(false);
    expect(backend.supportsExecutionMode('render-only')).toBe(false);
    expect(backend.supportsExecutionMode('validation-only')).toBe(true);
    expect(backend.qualities).toEqual({realtime:true,deterministic:true});
    const physics=new PhysicsSystem({backend});
    expect(physics.profile()).toMatchObject({
      backendCapabilities:expect.arrayContaining(['rigid-body','collision','scene-query']),
      runtimeCapabilities:expect.arrayContaining(['transform-state','articulation-pose','counterfactual-query']),
      capabilities:expect.arrayContaining(['rigid-body','transform-state','counterfactual-query']),
      backendExecutionModes:['realtime','validation-only'],
      runtimeExecutionModes:['render-only'],
      executionModes:['realtime','validation-only','render-only']
    });
    expect(physics.supportsExecutionMode('render-only')).toBe(true);
    expect(physics.profile().capabilities).not.toContain('snapshot-restore');
    expect(world).toBeTruthy(); backend.step(world,1/60); backend.dispose(world);
  });

  it('runs a render-only transform backend without pretending to provide solver capabilities',async()=>{
    const backend=new TransformPhysicsBackend();
    const physics=new PhysicsSystem({backend});
    const store=new ObjectStore();
    await physics.init();

    expect(physics.profile()).toMatchObject({
      identity:'transform', solverEnabled:false,
      capabilities:['transform-state','articulation-pose'],
      backendExecutionModes:['render-only'],
      runtimeExecutionModes:['render-only'],
      executionModes:['render-only']
    });
    expect(backend.hasCapability('collision')).toBe(false);
    expect(backend.supportsExecutionMode('render-only')).toBe(true);

    const root=new THREE.Group();
    root.position.set(1,2,3);
    const door=new THREE.Group(); door.name='door'; root.add(door);
    const manifest={
      physics:{body:'fixed',colliders:[{shape:'box',halfExtents:[1,1,1]}]},
      parts:{
        door:{
          node:'door', parent:'$root',
          joint:{type:'revolute',axis:[0,1,0],limits:[0,1]},
          targets:{open:0.5}
        }
      }
    };
    store.add('cabinet',{id:'cabinet',assetId:'cabinet',object:root,manifest,state:{}});
    physics.attach('cabinet',manifest,root);

    expect(physics.getPosition('cabinet')).toEqual([1,2,3]);
    expect(physics.setPosition('cabinet',[4,5,6])).toBe(true);
    expect(physics.getPosition('cabinet')).toEqual([4,5,6]);
    expect(physics.setArticulationTarget('cabinet','door',0.5)).toBe(true);
    expect(physics.articulationState('cabinet','door',{target:0.5})).toMatchObject({coordinate:expect.closeTo(0.5,5),target:0.5});
    expect(physics.bodyMotionState('cabinet')).toMatchObject({source:'transform-state',linearSpeed:0,angularSpeed:0});
    expect(physics.raycast([0,0,0],[1,0,0])).toBeNull();
    expect(physics.bodyPoseClear('cabinet',[0,0,0])).toMatchObject({clear:false,code:'PHYSICS_CAPABILITY_UNAVAILABLE',capability:'collision'});
    expect(physics.navigationObstacles()).toMatchObject({items:[],skipped:[{capability:'collision'}]});

    root.position.x=7;
    expect(physics.step(1/60,store)).toBe(true);
    expect(physics.remove('cabinet')).toBe(true);
    physics.dispose();
  });

});
