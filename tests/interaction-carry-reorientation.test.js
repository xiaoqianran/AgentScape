import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { InteractionSystem } from '../world/runtime/systems/InteractionSystem.js';

const agent={
  id:'agent_01',
  manifest:{type:'agent',embodiment:{holdAnchor:{translation:[0,.95,-.62],rotation:[0,0,0,1]}}}
};

function setup(clearance){
  const physics={
    getPosition:vi.fn((id)=>id==='agent_01'?[0,0,0]:[0,.95,-.62]),
    getRotation:vi.fn(()=>[0,0,0,1]),
    bodyMotionClear:vi.fn(clearance),
    setCharacterYaw:vi.fn(()=>true),
    setHeldPose:vi.fn(()=>true)
  };
  const store={get:vi.fn(()=>agent)};
  return {interactions:new InteractionSystem({store,physics,spatial:{},events:{emit(){}}}),physics};
}

describe('carry reorientation truth',()=>{
  it('checks every held-object yaw step and restores actor + held pose when the arc becomes blocked',()=>{
    let calls=0;
    const {interactions,physics}=setup(()=>++calls===1?{clear:true}:{clear:false,code:'CARRY_SWEEP_BLOCKED',blockedBy:['wall']});
    const result=interactions.reorientHeldToward('agent_01','cup_01',[1,0,0],{maxStep:Math.PI/4});
    expect(result).toMatchObject({clear:false,reason:'CARRY_REORIENT_BLOCKED',step:2,steps:2});
    expect(result.checks).toHaveLength(2);
    expect(physics.bodyMotionClear).toHaveBeenCalledTimes(2);
    expect(physics.setCharacterYaw).toHaveBeenLastCalledWith('agent_01',0);
    expect(physics.setHeldPose).toHaveBeenLastCalledWith('cup_01',[0,.95,-.62],[0,0,0,1]);
  });

  it('finishes a clear segmented yaw with the hold anchor facing the release point',()=>{
    const {interactions,physics}=setup(()=>({clear:true}));
    const result=interactions.reorientHeldToward('agent_01','cup_01',[1,0,0],{maxStep:Math.PI/6});
    expect(result.clear).toBe(true);
    expect(result.steps).toBe(3);
    expect(result.yaw).toBeCloseTo(-Math.PI/2,6);
    expect(physics.setCharacterYaw).toHaveBeenLastCalledWith('agent_01',expect.closeTo(-Math.PI/2,6));
    expect(physics.bodyMotionClear).toHaveBeenCalledTimes(3);
  });

  it('projects a hold anchor through the Agent yaw using the same placement frame', () => {
    const {interactions:system}=setup(()=>({clear:true}));
    const pose=system.holdPoseAt([1,0,2],-Math.PI/2,{translation:[0,1,-.5],rotation:[0,0,0,1]});
    expect(pose.position[0]).toBeCloseTo(1.5,6);
    expect(pose.position[1]).toBeCloseTo(1,6);
    expect(pose.position[2]).toBeCloseTo(2,6);
    const q=new THREE.Quaternion(...pose.rotation);
    expect(q.angleTo(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),-Math.PI/2))).toBeLessThan(1e-6);
  });

});
