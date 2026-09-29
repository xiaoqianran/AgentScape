import { describe, expect, it, vi } from 'vitest';
import { AgentRuntimeTestRunner } from '../../apps/studio/agent/AgentRuntimeTestRunner.js';

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

  it('builds a world from code: broken code rolls back, fixed code applies, promotion lands at the authored spot', async () => {
    const tools=toolsFrom(async(name,args)=>{
      if(name==='searchAssets') return {results:[{id:'cup'}]};
      if(name==='listObjects') return [
        {id:'entity_new',asset:'cup',position:[0.6,0.35,0]}
      ];
      if(name==='runAuthoringCode') return args.label.includes('broken')
        ? {status:'authoring-code-failed',reason:'AUTHORING_CODE_EXECUTION_ERROR',message:'THREE.StandarMaterial is not a constructor'}
        : {status:'authoring-code-applied',revision:{created:true,revision:{id:'rev_000002'}}};
      if(name==='promoteAuthoringNode') return {status:'authoring-promoted',nodeId:'desk-cup',entityId:'entity_new'};
      throw new Error(`unexpected tool ${name}`);
    });
    const runner=new AgentRuntimeTestRunner({tools});
    const result=await runner.run('authoring-code-world');
    expect(result.status).toBe('completed');
    expect(result.entity).toEqual({id:'entity_new',asset:'cup',position:[0.6,0.35,0]});
    const calls=tools.call.mock.calls.map(([name])=>name);
    expect(calls).toEqual(['searchAssets','runAuthoringCode','runAuthoringCode','promoteAuthoringNode','listObjects']);
    expect(tools.call.mock.calls[1][1].label).toBe('study room (broken)');
    expect(tools.call.mock.calls[2][1].label).toBe('study room');
    expect(tools.call.mock.calls[2][1].code).toContain('modelRef(cup, { assetRef: { assetId:');
  });

  it('requires the cup asset catalog before building the code world', async () => {
    const tools=toolsFrom(async(name)=>{
      if(name==='searchAssets') return {results:[{id:'table'}]};
      throw new Error(`unexpected tool ${name}`);
    });
    const runner=new AgentRuntimeTestRunner({tools});
    await expect(runner.run('authoring-code-world')).rejects.toThrow('资产目录中没有 cup');
  });

  it('picks up the code-created cup entity end to end', async () => {
    const tools=toolsFrom(async(name)=>{
      if(name==='getNavigationStatus') return {state:'ready'};
      if(name==='listObjects') return [
        {id:'cup_01',asset:'cup',position:[2.85,1.4,-3]},
        {id:'entity_new',asset:'cup',position:[0.6,0.35,0]}
      ];
      if(name==='approachAndPickup') return {status:'held',targetId:'entity_new'};
      if(name==='getCarryStatus') return {status:'held',targetId:'entity_new'};
      throw new Error(`unexpected tool ${name}`);
    });
    const runner=new AgentRuntimeTestRunner({tools});
    await expect(runner.run('authoring-code-pickup')).resolves.toMatchObject({status:'completed',targetId:'entity_new'});
    expect(tools.call.mock.calls.map(([name])=>name)).toEqual(['getNavigationStatus','listObjects','approachAndPickup','getCarryStatus']);
  });

  it('refuses pickup when navigation is not ready in an empty world', async () => {
    const tools=toolsFrom(async(name)=>{
      if(name==='getNavigationStatus') return {state:'dirty'};
      throw new Error(`unexpected tool ${name}`);
    });
    const runner=new AgentRuntimeTestRunner({tools});
    await expect(runner.run('authoring-code-pickup')).rejects.toThrow('导航网格');
  });

});
