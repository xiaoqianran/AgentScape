import { expect, it, vi } from 'vitest';
import { TaskPanel } from '../../apps/studio/ui/task/TaskPanel.js';
import { ToolCallingAgent } from '../../modules/agent/ToolCallingAgent.js';
import { createTaskRuntime, driveWorld, settleWorld } from '../../dev/acceptance/worldHarness.mjs';

it('prepares an offline task through authorized Skills, preserves provisional admission and supports undo',async()=>{
  const fixture = await createTaskRuntime('monument-hall');
  const complete = vi.fn();
  const gateway = {isConfigured:()=>false,complete};
  const panel = new TaskPanel();
  panel.attachAgent({agent:new ToolCallingAgent({tools:fixture.tools,gateway}),gateway});
  try {
    const before = fixture.runtime.snapshot();
    const result = await panel.prepareStandardTask();
    expect(result).toMatchObject({supported:true,admission:'world-provisional'});
    expect(panel.snapshot()).toMatchObject({busy:false,available:false});
    await settleWorld(fixture.runtime,60);
    expect(await panel.checkStandardTask()).toMatchObject({supported:true});
    expect(await panel.runStandardTask()).toBeNull();
    expect(complete).not.toHaveBeenCalled();
    expect(fixture.runtime.trace.list({type:'policy.decision'})).toEqual(expect.arrayContaining([expect.objectContaining({payload:expect.objectContaining({skill:'runWorldPipeline',allow:true})})]));
    await fixture.runtime.history.undo();
    expect(fixture.runtime.snapshot()).toEqual(before);
  } finally {panel.dispose();fixture.dispose();}
},30000);

it('cancels a real moving pickup at its safe boundary without releasing the cup or starting place',async()=>{
  const fixture = await createTaskRuntime('monument-hall');
  const setupPanel = new TaskPanel();
  setupPanel.attachAgent({agent:new ToolCallingAgent({tools:fixture.tools,gateway:{isConfigured:()=>false}}),gateway:{isConfigured:()=>false}});
  const controller = new AbortController();
  const calls = [];
  let off;
  try {
    expect(await setupPanel.prepareStandardTask()).toMatchObject({supported:true});
    await settleWorld(fixture.runtime,60);
    expect(await driveWorld(fixture.tools.call('approachAndInteract',{actorId:'agent_01',targetId:'cabinet_01',action:'open'}),fixture.runtime)).toMatchObject({status:'action-completed'});
    off = fixture.runtime.events.on('tool.called',event=>{
      calls.push(event.name);
      if (event.name==='approachAndPickup') queueMicrotask(()=>controller.abort());
    });
    const gateway = {isConfigured:()=>true,complete:vi.fn(async()=>({toolCalls:[
      {id:'pickup',name:'approachAndPickup',args:{actorId:'agent_01',targetId:'cup_01'}},
      {id:'place',name:'approachAndPlace',args:{actorId:'agent_01',supportId:'table_01'}}
    ]}))};
    const agent = new ToolCallingAgent({tools:fixture.tools,gateway});
    const result = await driveWorld(agent.run('拿起后放到桌面',{signal:controller.signal}),fixture.runtime);
    expect(result).toMatchObject({taskStatus:'cancelled',lastMutation:{tool:'approachAndPickup',outcome:{state:'verified'}}});
    expect(fixture.runtime.store.get('cup_01').state.heldBy).toMatchObject({kind:'agent',id:'agent_01'});
    expect(fixture.runtime.interactions.carryStatus('agent_01')).toMatchObject({status:'held',targetId:'cup_01'});
    expect(calls).not.toContain('approachAndPlace');
    expect(fixture.runtime.mutationOwner).toBeNull();
    expect(gateway.complete).toHaveBeenCalledOnce();
  } finally {off?.();setupPanel.dispose();fixture.dispose();}
},30000);

it('refuses the standard task after a fresh missing-target inspection, without a model request',async()=>{
  const fixture = await createTaskRuntime('monument-hall');
  const gateway = {isConfigured:()=>true,complete:vi.fn()};
  const panel = new TaskPanel();
  panel.attachAgent({agent:new ToolCallingAgent({tools:fixture.tools,gateway}),gateway});
  try {
    expect(await panel.prepareStandardTask()).toMatchObject({supported:true});
    await fixture.runtime.mutate('test:remove-cup',()=>fixture.runtime.commands.remove('cup_01'));
    expect(await panel.runStandardTask()).toBeNull();
    expect(panel.snapshot().standardTask).toMatchObject({supported:false,reasons:expect.arrayContaining([expect.objectContaining({code:'TASK_OBJECT_MISSING'})])});
    expect(gateway.complete).not.toHaveBeenCalled();
  } finally {panel.dispose();fixture.dispose();}
},30000);
