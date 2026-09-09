import { describe, expect, it, vi } from 'vitest';
import { AgentRuntimeTestRunner } from '../../studio/agent/AgentRuntimeTestRunner.js';

const toolsFrom = (handler) => ({ call: vi.fn(handler) });

describe('AgentRuntimeTestRunner', () => {
  it('walks to a target through interaction-pose discovery and physical navigation', async () => {
    const tools=toolsFrom(async(name,args)=>{
      if(name==='findInteractionPose') return {status:'approach-pose',position:[1,0,2]};
      if(name==='navigateTo') return {status:'arrived',position:[1,0,2]};
      if(name==='getLocomotionStatus') return {status:'idle',id:'agent_01'};
      throw new Error(`unexpected tool ${name}`);
    });
    const runner=new AgentRuntimeTestRunner({tools});
    await expect(runner.run('walk-to-cup')).resolves.toMatchObject({status:'completed',targetId:'cup_01'});
    expect(tools.call.mock.calls.map(([name])=>name)).toEqual(['findInteractionPose','navigateTo','getLocomotionStatus']);
    expect(tools.call).toHaveBeenNthCalledWith(2,'navigateTo',{id:'agent_01',end:[1,0,2],speed:2});
  });

  it('verifies pickup ownership instead of accepting pickup request alone', async () => {
    const tools=toolsFrom(async(name)=>{
      if(name==='approachAndPickup') return {status:'held',targetId:'cup_01'};
      if(name==='getCarryStatus') return {status:'held',targetId:'cup_01'};
      throw new Error(`unexpected tool ${name}`);
    });
    const runner=new AgentRuntimeTestRunner({tools});
    await expect(runner.run('pickup-cup')).resolves.toMatchObject({status:'completed',carry:{status:'held',targetId:'cup_01'}});
    expect(tools.call.mock.calls.map(([name])=>name)).toEqual(['approachAndPickup','getCarryStatus']);
  });

  it('surfaces the exact blocked pickup transfer phase and blocker', async () => {
    const tools=toolsFrom(async(name)=>{
      if(name==='approachAndPickup') return {
        status:'pickup-blocked',reason:'PICKUP_TRANSFER_BLOCKED',
        transfer:{reason:'PICKUP_ANCHOR_BLOCKED',phases:[{phase:'anchor',clear:false,blockedBy:['table_01']}]}
      };
      throw new Error(`unexpected tool ${name}`);
    });
    const runner=new AgentRuntimeTestRunner({tools});
    await expect(runner.run('pickup-cup')).rejects.toThrow('pickup-blocked · PICKUP_TRANSFER_BLOCKED · PICKUP_ANCHOR_BLOCKED · phase=anchor · blockedBy=table_01');
  });

  it('places only after ensuring the cup is held, then verifies support and empty hands', async () => {
    let carryReads=0;
    const tools=toolsFrom(async(name)=>{
      if(name==='getCarryStatus') return ++carryReads===1 ? {status:'empty'} : carryReads===2 ? {status:'held',targetId:'cup_01'} : {status:'empty'};
      if(name==='approachAndPickup') return {status:'held',targetId:'cup_01'};
      if(name==='approachAndPlace') return {status:'placed',supportVerified:true,settled:true};
      throw new Error(`unexpected tool ${name}`);
    });
    const runner=new AgentRuntimeTestRunner({tools});
    await expect(runner.run('place-cup')).resolves.toMatchObject({status:'completed',place:{status:'placed',supportVerified:true}});
    expect(tools.call.mock.calls.map(([name])=>name)).toEqual(['getCarryStatus','approachAndPickup','getCarryStatus','approachAndPlace','getCarryStatus']);
  });

  it('rejects navigation readiness when the NavMesh is not ready', async () => {
    const tools=toolsFrom(async(name)=>{
      if(name==='getNavigationStatus') return {state:'dirty'};
      throw new Error(`unexpected tool ${name}`);
    });
    const runner=new AgentRuntimeTestRunner({tools});
    await expect(runner.run('navigation-status')).rejects.toThrow('getNavigationStatus 未通过');
  });

  it('rejects a placed result until Physics settle is verified', async () => {
    const tools=toolsFrom(async(name)=>{
      if(name==='getCarryStatus') return {status:'held',targetId:'cup_01'};
      if(name==='approachAndPlace') return {status:'placed',supportVerified:true,settled:false};
      throw new Error(`unexpected tool ${name}`);
    });
    const runner=new AgentRuntimeTestRunner({tools});
    await expect(runner.run('place-cup')).rejects.toThrow('approachAndPlace 未通过：placed');
  });

});
