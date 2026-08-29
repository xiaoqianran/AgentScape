import { describe, expect, it, vi } from 'vitest';
import { InteractionSystem } from '../world/runtime/systems/InteractionSystem.js';
import { DEFAULT_WAYPOINT_TOLERANCE } from '../world/runtime/systems/LocomotionSystem.js';

const setup=()=>{
  const physics={bodyMotionClear:vi.fn((_id,targetPosition)=>({clear:targetPosition[0]>.3}))};
  const spatial={getBounds:vi.fn(()=>({center:[0,0,0]}))};
  const system=new InteractionSystem({store:{list:()=>[],get:()=>({manifest:{physics:{colliders:[{shape:'capsule',radius:.18}]}}})},physics,spatial,locomotion:{},events:{emit(){}}});
  system.assertAgentCarryable=vi.fn(()=>({}));
  system.holdAnchor=vi.fn(()=>({translation:[0,.95,-.62],rotation:[0,0,0,1]}));
  return {system,physics};
};

describe('deterministic pickup plan',()=>{
  it('reserves locomotion arrival tolerance and accepts only a transfer-clear candidate',async()=>{
    const {system,physics}=setup();
    system.findInteractionPose=vi.fn(async(_actor,_target,options)=>{
      expect(options.maxDistance).toBeCloseTo(1.5-DEFAULT_WAYPOINT_TOLERANCE,6);
      expect(options.standOff).toBeCloseTo(.8,6);
      expect(options.candidateFilter([-.2,0,1])).toBe(false);
      expect(options.candidateFilter([1,0,0])).toBe(true);
      return {status:'approach-pose',position:[1,0,0],distance:1};
    });
    const plan=await system.findPickupPlan('agent_01','blocker_01');
    expect(plan).toMatchObject({
      pose:{status:'approach-pose',position:[1,0,0]},
      transfer:{clear:true},
      plannedMaxDistance:1.5-DEFAULT_WAYPOINT_TOLERANCE
    });
    expect(plan.facingYaw).toBeCloseTo(Math.PI/2,6);
    expect(physics.bodyMotionClear).toHaveBeenCalled();
  });

  it('fails with a pickup-specific reason when no candidate can clear the hold transfer',async()=>{
    const {system}=setup();
    system.findInteractionPose=vi.fn(async(_actor,_target,{candidateFilter})=>{
      expect(candidateFilter([-.2,0,1])).toBe(false);
      return null;
    });
    await expect(system.findPickupPlan('agent_01','blocker_01')).rejects.toMatchObject({
      code:'CARRY_UNAVAILABLE',details:{reason:'NO_PICKUP_TRANSFER_POSE'}
    });
  });
});
