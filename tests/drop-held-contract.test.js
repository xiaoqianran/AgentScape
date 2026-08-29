import { describe,expect,it } from 'vitest';
import { SkillRegistry } from '../agent/skills/SkillRegistry.js';

describe('dropHeld verified post-condition',()=>{
  const registry=()=>{
    const value=new SkillRegistry();
    value.register({name:'dropHeld',mutates:true,handler:()=>null});
    return value;
  };

  it('does not treat release-only dropped status as verified',()=>{
    expect(registry().executionPolicy('dropHeld',{status:'dropped',targetId:'cup_01'}).outcome)
      .toEqual({state:'unverified',verified:false,status:'dropped',reason:'POST_CONDITION_NOT_VERIFIED'});
  });

  it('verifies drop only after ownership is released and the dynamic object settles',()=>{
    expect(registry().executionPolicy('dropHeld',{
      status:'dropped',targetId:'cup_01',released:true,settled:true,stillHeld:false
    }).outcome).toEqual({state:'verified',verified:true,status:'dropped'});
  });
});
