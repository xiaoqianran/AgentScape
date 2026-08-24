import { describe, expect, it, vi } from 'vitest';
import { InteractionSystem } from '../src/runtime/systems/InteractionSystem.js';

const record = {
  id:'cab_1', state:{},
  manifest:{
    actions:['open','close'],
    parts:{
      left:{ node:'LeftDoor', actions:['open','close'], targets:{open:-1,close:0} },
      right:{ node:'RightDoor', actions:['open','close'], targets:{open:1,close:0} }
    }
  }
};

const make = () => {
  const physics = {
    setArticulationTarget:vi.fn(()=>true),
    articulationState:vi.fn((_id,_part,{target}={})=>({coordinate:0,target,error:Math.abs(target ?? 0),tolerance:.08,jointType:'revolute',limits:[-1,1],coordinateReference:'rest-zero-pose'}))
  };
  const events = { emit:vi.fn() };
  const system = new InteractionSystem({ store:{ get:()=>record }, physics, spatial:{}, events });
  return { system, physics, events };
};

describe('InteractionSystem articulated actions', () => {
  it('targets a named executable part without assuming a door key', () => {
    const { system, physics } = make();
    const result = system.setArticulationAction('cab_1','open',{partName:'right'});
    expect(result).toMatchObject({part:'right',action:'open',target:1});
    expect(physics.setArticulationTarget).toHaveBeenCalledWith('cab_1','right',1);
    expect(record.state.partTargets.right).toBe('open');
    expect(record.state.parts?.right).toBeUndefined();
  });

  it('rejects ambiguous articulated actions unless a part is selected', () => {
    const { system } = make();
    expect(() => system.setArticulationAction('cab_1','open')).toThrow(/does not support open/);
  });

  it('blocks embodied door actions while the Agent is carrying an object', async () => {
    const { system } = make();
    system.agentHeld.set('agent_01','cup_1');
    await expect(system.approachAndInteract('agent_01','cab_1','open')).resolves.toMatchObject({
      status:'interaction-blocked',reason:'HANDS_FULL',heldId:'cup_1',requires:'dropHeld'
    });
  });
});
