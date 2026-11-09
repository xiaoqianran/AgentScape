import { describe, expect, it, vi } from 'vitest';
import { ToolCallingAgent, normalizeModelToolCall } from '../../modules/agent/ToolCallingAgent.js';
import { invokeAgentTool } from '../../modules/agent/execution/AgentToolInvoker.js';
import { finalizeModelResponse, finalizePlanningLimit } from '../../modules/agent/execution/AgentRunResults.js';

const defaultFinalState = () => ({
  taskAcceptanceBundle:null,
  lastMutation:null,
  sceneTaskPlan:null,
  sceneGoalEvidence:null,
  unresolvedMutations:new Map(),
  execution:[],
  log:vi.fn()
});

describe('Agent tool execution boundary', () => {
  it('passes the cancellation signal only through trusted interaction context', async () => {
    const signal = new AbortController().signal;
    const tools = { call:vi.fn(async () => undefined) };
    const done = await invokeAgentTool(tools, {name:'interactScene',args:{interaction:{action:'pickup'}}}, {signal});
    expect(tools.call).toHaveBeenCalledWith('interactScene', {interaction:{action:'pickup'}}, {signal});
    expect(done).toMatchObject({safeResult:{ok:true},invocationFailed:false,policy:{barrier:false,outcome:{state:'accepted',verified:null}}});
    await invokeAgentTool(tools, {name:'listObjects',args:{}}, {signal});
    expect(tools.call).toHaveBeenLastCalledWith('listObjects', {});
  });

  it('uses exact runtime-issued revision context and clones it before invocation', async () => {
    const tools={call:vi.fn(async () => ({status:'ok'}))};
    const lineage={parentRevisionId:'revA'};
    await invokeAgentTool(tools,{name:'proposeWorldIR',args:{input:1}},{pendingWorldProposalLineage:lineage});
    expect(tools.call).toHaveBeenLastCalledWith('proposeWorldIR',{input:1},{worldProposalLineage:lineage});
    expect(tools.call.mock.lastCall[2].worldProposalLineage).not.toBe(lineage);
    const repair={baseWorldIR:{revision:{id:'base'}},revisionContext:{baseRevisionId:'base'}};
    await invokeAgentTool(tools,{name:'proposeWorldRevision',args:{}},{pendingWorldRevisionRepair:repair});
    expect(tools.call).toHaveBeenLastCalledWith('proposeWorldRevision',{}, {worldRevisionRepair:repair});
    const issued=new Map([['next',{baseWorldIR:{revision:{id:'base'}}}]]);
    await invokeAgentTool(tools,{name:'recompileWorldRevision',args:{proposal:{nextRevisionId:'next'}}},{issuedWorldRevisionProposals:issued});
    expect(tools.call).toHaveBeenLastCalledWith('recompileWorldRevision',{proposal:{nextRevisionId:'next'}},{worldRevisionBaseIR:{revision:{id:'base'}}});
  });

  it('keeps tool errors recoverable and captures only newly committed acceptance evidence', async () => {
    const old={required:true,result:{status:'world-rejected'}};
    const current={required:true,result:{status:'world-accepted'}};
    const tools={
      runtime:{lastAcceptanceBundle:old},
      call:vi.fn(async () => {tools.runtime.lastAcceptanceBundle=current;throw Object.assign(new Error('denied'),{code:'PERMISSION_DENIED'});})
    };
    const outcome=await invokeAgentTool(tools,{name:'replace',args:{}});
    expect(outcome).toMatchObject({
      invocationFailed:true,acceptanceChanged:true,
      safeResult:{error:'denied',code:'PERMISSION_DENIED'},
      policy:{outcome:{state:'error',verified:false,reason:'PERMISSION_DENIED'}},
      acceptanceBundle:current
    });
    expect(outcome.acceptanceBundle).not.toBe(current);
    tools.call.mockResolvedValue(undefined);
    tools.call.mockImplementation(async () => undefined);
    const again=await invokeAgentTool(tools,{name:'read',args:{}});
    expect(again.acceptanceChanged).toBe(false);
    expect(again.acceptanceBundle).toBeNull();
  });
});

describe('Agent result verification boundary', () => {
  it('does not claim successful world mutation for a text-only answer', () => {
    const state=defaultFinalState();
    const outcome=finalizeModelResponse({response:{message:'好的'},step:0,...state});
    expect(outcome).toMatchObject({message:'好的',taskStatus:'no-mutation',steps:1,execution:[]});
  });

  it('does not trust completion text over an unresolved or unverified operation', () => {
    const state=defaultFinalState();
    state.lastMutation={tool:'approachAndPickup',outcome:{state:'failed',verified:false}};
    state.unresolvedMutations.set('pickup',{tool:'approachAndPickup',identity:'pickup',args:{}});
    const outcome=finalizeModelResponse({response:{message:'完成了'},step:2,...state});
    expect(outcome).toMatchObject({taskStatus:'incomplete',unresolvedMutations:[{identity:'pickup'}]});
    expect(state.log).toHaveBeenCalledWith(expect.stringContaining('task incomplete'),'error');
  });

  it('requires live scene goal evidence even if the last mutation succeeded', () => {
    const state=defaultFinalState();
    state.sceneTaskPlan={criteria:[{id:'goal'}],dependencies:{}};
    state.sceneGoalEvidence={status:'world-incomplete',failedCount:1,checks:[{id:'goal',verified:false}]};
    state.lastMutation={tool:'interactScene',outcome:{state:'verified',verified:true}};
    const outcome=finalizeModelResponse({response:{message:'已完成'},step:1,...state});
    expect(outcome).toMatchObject({taskStatus:'incomplete',message:'任务未完成：1 个目标尚未通过当前世界验证。'});
  });

  it('retains planning-limit evidence and never reports unresolved work as completed', () => {
    const state=defaultFinalState();
    const recordSequence=vi.fn();
    state.unresolvedMutations.set('one',{tool:'open',identity:'one'});
    const outcome=finalizePlanningLimit({maxSteps:3,recordSequence,...state});
    expect(outcome).toMatchObject({taskStatus:'incomplete',termination:'planning-limit',steps:3});
    expect(recordSequence).toHaveBeenCalledWith(expect.objectContaining({termination:'planning-limit',unresolved:1}));
  });

  it('permits a verified scene plan at the exact planning limit', () => {
    const state=defaultFinalState();
    state.sceneTaskPlan={criteria:[{id:'goal'}],dependencies:{}};
    state.sceneGoalEvidence={status:'world-accepted',checks:[{id:'goal',verified:true}]};
    const outcome=finalizePlanningLimit({maxSteps:3,recordSequence:vi.fn(),...state});
    expect(outcome).toMatchObject({taskStatus:'completed',steps:3});
  });
});

it('isolates concurrent Agent runs so one task never borrows another task mutation state', async () => {
  const rounds=new Map();
  const tools={
    actor:'worker',
    definitions:()=>[{name:'change'}],
    call:vi.fn(async (name,args) => name==='listObjects' ? [] : {status:'changed',id:args.id}),
    executionPolicy:(name) => name==='change'
      ? {mutates:true,barrier:true,tracksUnresolved:true,outcome:{state:'verified',verified:true}}
      : {mutates:false,barrier:false,outcome:{state:'accepted',verified:null}}
  };
  const gateway={
    isConfigured:()=>true,
    complete:async ({messages}) => {
      const goal=messages[1].content, count=rounds.get(goal)||0;
      rounds.set(goal,count+1);
      return count===0
        ? {message:'apply',toolCalls:[{id:'call-'+goal,name:'change',args:{id:goal}}]}
        : {message:'finished',toolCalls:[]};
    }
  };
  const agent=new ToolCallingAgent({tools,gateway,maxSteps:3});
  const results=await Promise.all([agent.run('left'),agent.run('right')]);
  expect(results.map(result=>result.taskStatus)).toEqual(['completed','completed']);
  expect(results.map(result=>result.lastMutation.args.id)).toEqual(['left','right']);
  expect(results.map(result=>result.execution.length)).toEqual([1,1]);
  expect(rounds.get('left')).toBe(2);
  expect(rounds.get('right')).toBe(2);
  expect(normalizeModelToolCall({name:'listObjects',args:{}})).toEqual({name:'listObjects',args:{}});
});

it('preserves the original ToolCallingAgent receiver for configured log callbacks', async () => {
  const receivers = [];
  const tools = {
    actor:'worker',
    definitions:() => [],
    call:async () => []
  };
  const gateway = {
    isConfigured:() => true,
    complete:async () => ({message:'read-only',toolCalls:[]})
  };
  const agent = new ToolCallingAgent({
    tools, gateway,
    log:function () { receivers.push(this); }
  });
  const result = await agent.run('report');
  expect(result.taskStatus).toBe('no-mutation');
  expect(receivers.length).toBeGreaterThanOrEqual(2);
  expect(receivers.every(receiver => receiver === agent)).toBe(true);
});
