import { createRapierPhysicsSystem } from './helpers/createRapierPhysicsSystem.js';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { ObjectStore } from '../src/runtime/ObjectStore.js';
import { PhysicsSystem } from '../src/runtime/systems/PhysicsSystem.js';

const manifest={
  id:'cup-test',type:'cup',source:{kind:'builtin'},actions:['pickup','drop'],
  physics:{body:'dynamic',mass:.3,colliders:[{shape:'cylinder',halfHeight:.16,radius:.15,translation:[0,.16,0]}]}
};

async function setup(){
  const physics=createRapierPhysicsSystem(); await physics.init();
  const store=new ObjectStore();
  const object=new THREE.Group(); object.position.set(0,0,1); object.updateMatrixWorld(true);
  store.add('cup',{id:'cup',assetId:'cup-test',object,manifest,state:{}});
  physics.attach('cup',manifest,object);
  physics.step(1/60,store);
  return {physics,store,object};
}

describe('PhysicsSystem carry primitives',()=>{
  it('shape-casts a carried body and reports a physical wall before the target pose',async()=>{
    const {physics}=await setup();
    physics.addEnvironment([{shape:'box',halfExtents:[1,1,.08],translation:[0,1,0]}]);
    const result=physics.bodyMotionClear('cup',[0,0,-1],[0,0,0,1]);
    expect(result).toMatchObject({clear:false,code:'CARRY_SWEEP_BLOCKED',blockedBy:['$environment']});
    expect(result.toi).toBeGreaterThanOrEqual(0);
    expect(result.toi).toBeLessThanOrEqual(1);
    physics.dispose();
  });

  it('moves a held kinematic body with setHeldTarget and restores its original Dynamic type',async()=>{
    const {physics,store,object}=await setup();
    expect(physics.setHeld('cup',true)).toBe(true);
    expect(physics.setHeldTarget('cup',[1,.2,1],[0,0,0,1])).toBe(true);
    physics.step(1/60,store);
    expect(object.position.x).toBeCloseTo(1,5);
    expect(object.position.y).toBeCloseTo(.2,5);
    expect(object.position.z).toBeCloseTo(1,5);
    expect(physics.entries.get('cup').body.isKinematic()).toBe(true);
    physics.setHeld('cup',false);
    expect(physics.entries.get('cup').body.isDynamic()).toBe(true);
    const state=physics.bodyMotionState('cup');
    expect(state).toMatchObject({sleeping:expect.any(Boolean),linearSpeed:expect.any(Number),angularSpeed:expect.any(Number)});
    expect(state.linearSpeed).toBeGreaterThanOrEqual(0);
    physics.dispose();
  });

  it('checks a carried body target pose without conflating endpoint occupancy with path sweep',async()=>{
    const {physics}=await setup();
    physics.addEnvironment([{shape:'box',halfExtents:[.3,.4,.3],translation:[1,.4,1]}]);
    expect(physics.bodyPoseClear('cup',[0,0,1],[0,0,0,1])).toEqual({clear:true});
    expect(physics.bodyPoseClear('cup',[1,0,1],[0,0,0,1])).toMatchObject({
      clear:false,code:'CARRY_TARGET_BLOCKED',blockedBy:['$environment']
    });
    physics.dispose();
  });

});
