import { describe, expect, it, vi } from 'vitest';
import { createProgressiveAgentTools } from '../../application/agent/ProgressiveAgentTools.js';
import { mutationIdentity } from '../../modules/agent/execution/AgentExecutionRules.js';
import { buildAgentSystemPrompt } from '../../modules/agent/prompt/index.js';

function createBase() {
  const definitions = [
    { name:'listObjects',description:'List world objects',parameters:{type:'object',properties:{}} },
    { name:'addSceneModel',description:'Add a low-poly model',parameters:{type:'object',properties:{model:{type:'object'}}} },
    { name:'readStudioProject',description:'Read the current Studio project',parameters:{type:'object',properties:{}} },
    { name:'runWorldPipeline',description:'Admit a compiled world revision',parameters:{type:'object',properties:{plan:{type:'object'}}} },
    { name:'rareDiagnostic',description:'Inspect rare status',parameters:{type:'object',properties:{value:{type:'string'}}} }
  ];
  return {
    runtime:{events:{emit:vi.fn()}},actor:'agent_01',
    definitions:()=>definitions,
    call:vi.fn(async(name,args)=>({name,args})),
    executionPolicy:vi.fn(()=>({mutates:false})),
    taskObservation:vi.fn(()=>({world:'ok'})),
    recordSequence:vi.fn()
  };
}

describe('Studio progressive LLM tool catalog', () => {
  it('starts with bounded core schemas and lets the model discover additional tool signatures', async () => {
    const base=createBase(), tools=createProgressiveAgentTools(base);
    const visible=tools.definitions().map(x=>x.name);
    expect(visible).toEqual(['listObjects','addSceneModel','readStudioProject','discoverAgentTools']);
    expect(tools.fullDefinitions().map(x=>x.name)).toContain('runWorldPipeline');
    const catalog=await tools.call('discoverAgentTools',{});
    expect(catalog.status).toBe('tool-catalog');
    expect(catalog.totalAvailable).toBe(5);
    expect(catalog.tools.map(x=>x.name)).toContain('runWorldPipeline');
    expect(base.call).not.toHaveBeenCalled();
    const exposure=await tools.call('discoverAgentTools',{names:['runWorldPipeline']});
    expect(exposure.status).toBe('tool-catalog-updated');
    expect(tools.definitions().map(x=>x.name)).toContain('runWorldPipeline');
    await expect(tools.call('runWorldPipeline',{plan:{}})).resolves.toEqual({name:'runWorldPipeline',args:{plan:{}}});
    expect(base.call).toHaveBeenCalledTimes(1);
    expect(tools.executionPolicy('discoverAgentTools',{})).toMatchObject({mutates:false,barrier:false,auxiliary:true});
    expect(tools.executionPolicy('runWorldPipeline',{})).toEqual({mutates:false});
  });

  it('resets optional exposed schemas between user tasks and rejects invented tools', async () => {
    const tools=createProgressiveAgentTools(createBase());
    await tools.call('discoverAgentTools',{names:['rareDiagnostic']});
    expect(tools.definitions().some(x=>x.name==='rareDiagnostic')).toBe(true);
    tools.beginTask('create another world');
    expect(tools.definitions().some(x=>x.name==='rareDiagnostic')).toBe(false);
    await expect(tools.call('discoverAgentTools',{names:['inventedTool']})).rejects.toMatchObject({code:'TOOL_DISCOVERY_INVALID'});
    await expect(tools.call('discoverAgentTools',{names:[]})).rejects.toMatchObject({code:'TOOL_DISCOVERY_INVALID'});
    expect((await tools.call('discoverAgentTools',{query:'rare'})).tools.map(x=>x.name)).toEqual(['rareDiagnostic']);
  });

  it('keeps a collision-free identity for different nested scene model IDs',()=>{
    const apple=mutationIdentity({name:'addSceneModel',args:{model:{id:'apple_tree',asset:'builtin://tree'}}});
    const pear=mutationIdentity({name:'addSceneModel',args:{model:{id:'pear_tree',asset:'builtin://tree'}}});
    expect(apple).toContain('apple_tree');
    expect(pear).not.toBe(apple);
    const prompt=buildAgentSystemPrompt([{name:'discoverAgentTools'},{name:'readStudioProject'},{name:'addSceneModel'}]);
    expect(prompt).toContain('discoverAgentTools');
    expect(prompt).toContain('organic silhouettes');
    expect(prompt).toContain('different world from the built-in Scene');
    expect(prompt).toContain('omitting source to create the small default scaffold');
    expect(prompt).toContain('Do not silently switch the user');
  });
  it('exposes newly discovered tools on the very next model planning round', async () => {
    const { ToolCallingAgent } = await import('../../modules/agent/ToolCallingAgent.js');
    const base=createBase();
    const existingCall=base.call;
    base.call=vi.fn(async(name,args,context)=>{
      if(name==='listObjects') return [];
      if(name==='observeScene') return {objects:[],relations:[]};
      return existingCall(name,args,context);
    });
    const requests=[];
    const responses=[
      {message:'Locate the inspection tool',toolCalls:[{id:'c1',name:'discoverAgentTools',args:{names:['rareDiagnostic']}}]},
      {message:'Inspect',toolCalls:[{id:'c2',name:'rareDiagnostic',args:{value:'apple-tree'}}]},
      {message:'Done',toolCalls:[]}
    ];
    const gateway={isConfigured:()=>true,complete:async request=>{
      requests.push(request);
      return responses.shift();
    }};
    const agent=new ToolCallingAgent({tools:createProgressiveAgentTools(base),gateway,maxSteps:4});
    const outcome=await agent.run('Inspect the generated apple tree');
    expect(outcome.taskStatus).toBe('no-mutation');
    expect(requests).toHaveLength(3);
    expect(requests[0].tools.some(x=>x.name==='rareDiagnostic')).toBe(false);
    expect(requests[1].tools.some(x=>x.name==='rareDiagnostic')).toBe(true);
    expect(outcome.execution.map(x=>x.tool)).toEqual(['discoverAgentTools','rareDiagnostic']);
  });

});
