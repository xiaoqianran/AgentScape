import { describe, expect, it, vi } from 'vitest';
import { AgentTools } from '../src/agent/AgentTools.js';

const runtime = () => ({
  events: { emit: vi.fn() },
  trace: { emit: vi.fn() },
  skills: { executionPolicy:vi.fn((name)=>({mutates:name==='open',barrier:name==='open',outcome:{state:'verified',verified:true}})), definitions: vi.fn(() => [{ name:'open', parameters:{ required:['id'] } }]), invoke: vi.fn(async (name, args, context) => name === 'destroyWorld' ? ({ success:false, error:{ code:'not_found', message:'Unknown skill' } }) : name === 'moveObject' && args.position == null ? ({ success:false, error:{ code:'invalid_input', message:'Missing required fields: position' } }) : ({ success: true, result: { name, args, context } })) }
});

describe('AgentTools registry facade', () => {
  it('rejects unknown tools before registry dispatch', async () => {
    const tools = new AgentTools(runtime());
    await expect(tools.call('destroyWorld', {})).rejects.toMatchObject({ code: 'not_found' });
  });

  it('rejects missing required args', async () => {
    const tools = new AgentTools(runtime());
    await expect(tools.call('moveObject', { id: 'a' })).rejects.toMatchObject({ code: 'invalid_input' });
  });

  it('routes world actions through the skill registry with an actor/profile', async () => {
    const r = runtime();
    const tools = new AgentTools(r, { profile: 'builder', actor: 'llm-agent' });
    await tools.call('open', { id: 'cabinet_01' });
    expect(r.skills.invoke).toHaveBeenCalledWith('open', { id: 'cabinet_01' }, { profile: 'builder', actor: 'llm-agent' });
  });

  it('routes semantic, asset and engine tools through the same boundary', async () => {
    const r = runtime(); const tools = new AgentTools(r);
    await tools.call('listRelations', { predicate: 'ON' });
    await tools.call('searchAssets', { query: 'chair' });
    await tools.call('validateWorld', {});
    expect(r.skills.invoke.mock.calls.map((c) => c[0])).toEqual(['listRelations', 'searchAssets', 'validateWorld']);
  });

  it('surfaces structured registry failures as domain errors', async () => {
    const r = runtime();
    r.skills.invoke.mockResolvedValueOnce({ success: false, error: { code: 'forbidden', message: 'Missing permissions' } });
    const tools = new AgentTools(r, { profile: 'viewer' });
    await expect(tools.call('open', { id: 'cabinet_01' })).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('exposes internal execution policy and records sequence gates through existing observability',()=>{
    const r=runtime(); const tools=new AgentTools(r,{actor:'agent_01'});
    expect(tools.executionPolicy('open',{})).toMatchObject({mutates:true,barrier:true,outcome:{state:'verified'}});
    tools.recordSequence({event:'tool-outcome',tool:'open',outcome:{state:'verified',verified:true}});
    expect(r.events.emit).toHaveBeenCalledWith('agent.sequence',expect.objectContaining({tool:'open'}));
    expect(r.trace.emit).toHaveBeenCalledWith('agent.sequence',expect.objectContaining({tool:'open'}),{actor:'agent_01'});
  });


  it('delegates compact task observation without exposing a new mutable world state',()=>{
    const r=runtime();
    r.store={
      has:(id)=>id==='agent_01',
      get:()=>({assetId:'agent',manifest:{type:'agent',parts:{}},object:{position:{toArray:()=>[1,0,2]}}})
    };
    r.physics={getPosition:()=>[1,0,2]};
    r.locomotion={status:()=>({status:'idle'})};
    r.interactions={carryStatus:()=>({status:'empty',actorId:'agent_01'})};
    const tools=new AgentTools(r,{actor:'agent_01'});
    const observation=tools.taskObservation({lastMutation:null,unresolvedMutations:[]});
    expect(observation).toMatchObject({
      schema:'agentscape.task-observation.v1',
      actor:{id:'agent_01',position:[1,0,2],navigation:{status:'idle'},carry:{status:'empty'}},
      objects:[{id:'agent_01',asset:'agent',type:'agent',position:[1,0,2]}],
      unresolvedMutations:[]
    });
    expect(r).not.toHaveProperty('taskObservation');
  });

});

it('forwards internal planner lineage without allowing it to override actor or profile',async()=>{
  const r=runtime();
  const tools=new AgentTools(r,{profile:'builder',actor:'llm-agent'});
  await tools.call('open',{id:'cabinet_01'},{
    profile:'viewer',actor:'forged',worldProposalLineage:{parentRevisionId:'world-r1'}
  });
  expect(r.skills.invoke).toHaveBeenCalledWith('open',{id:'cabinet_01'}, {
    profile:'builder',actor:'llm-agent',worldProposalLineage:{parentRevisionId:'world-r1'}
  });
});
