import {describe,it,expect} from 'vitest';
import {normalizeExecution} from '../../apps/agent-host/AgentExecution.js';
import {finalizeRun} from '../../apps/agent-host/AgentRunFinalizer.js';

const tree={id:'tree-check',kind:'object-exists',targetId:'tree'};
const criteria=[tree];
const result=value=>({content:[{type:'text',text:JSON.stringify(value)}]});
const accepted=(checks,revision=5)=>({
  schema:'agentscape.scene-result',operation:'verify',status:'succeeded',revision,
  verification:{status:'verified',evidence:{status:'world-accepted',checks:checks.map(check=>({...check,verified:true}))}}
});
const tool=(name,args,payload,callId=name)=>({name,callId,args,result:result(payload)});
const calls=[
  tool('scene_add_model',{model:{id:'tree'}},{status:'succeeded'}),
  tool('scene_verify',{criteria},accepted(criteria))
];
const normalizePi=()=>normalizeExecution('pi',calls);
const normalizeDsh=()=>{
  const events=[];
  for(const call of calls){
    events.push({type:'tool/call',data:{name:'mcp__agentscape__'+call.name,callId:call.callId,
      arguments:JSON.stringify(call.args)}});
    events.push({type:'tool/result',data:{message:{toolCallId:call.callId,...call.result}}});
  }
  return normalizeExecution('dsh',events);
};
function fixture({revision=5,after=revision,verification='verified',projectState=null}={}){
  const invoked=[],projectRead=[];
  const connection=async ({projectScope})=>({
    worldSessionId:'world-session',
    tools:['scene_verify','scene_observe','studio_project'].map(name=>({
      name,execute:async(_id,args)=>{
        invoked.push({name,args,projectScope});
        if(name==='scene_observe'){
          const count=invoked.filter(item=>item.name==='scene_observe').length;
          return result({schema:'agentscape.scene-object-page',revision:count===1?revision:after});
        }
        if(name==='studio_project'){
          projectRead.push(args);
          return result(projectState || {active:true,revision:3,runningRevision:3,project:{id:'world_abc'},observation:{project:{entities:[{id:'tree'}]}}});
        }
        const checks=args.criteria.map(check=>({...check,verified:verification==='verified'}));
        return result(verification==='verified' ? accepted(checks,revision) : {
          schema:'agentscape.scene-result',operation:'verify',status:'succeeded',revision,
          verification:{status:'unverified',evidence:{status:'world-incomplete',checks}}
        });
      }
    })),
    close:async()=>{}
  });
  return {connection,invoked,projectRead};
}
const config={mcpUrl:'http://127.0.0.1:39015/agent-mcp',mcpToken:'a'.repeat(32)};
const finish=(backend,execution,fixtureOptions={},more={})=>{
  const mock=fixture(fixtureOptions);
  return finalizeRun({output:{backend,taskStatus:'incomplete',execution,message:'Tree built',...more},expectedWorldSessionId:'world-session',
    configuration:config,mcpConnector:mock.connection}).then(output=>({output,mock}));
};

describe('shared Pi / DSH execution and Host admission',()=>{
  it('normalizes both SDK formats and evaluates one identical live Runtime',async()=>{
    const pi=normalizePi(),dsh=normalizeDsh();
    expect(dsh).toEqual(pi);
    for(const backend of ['pi','dsh']){
      const {output,mock}=await finish(backend,backend==='pi'?pi:dsh);
      expect(output.taskStatus).toBe('completed');
      expect(output.verified).toBe(true);
      expect(output.schema).toBe('agentscape.agent-run');
      expect(output.world).toMatchObject({worldSessionId:'world-session',sceneRevision:5});
      expect(output.verification.checks).toHaveLength(2);
      expect(mock.invoked.map(call=>call.name)).toEqual(['scene_observe','scene_verify','scene_observe']);
      expect(mock.invoked.find(call=>call.name==='scene_verify').args.criteria)
        .toEqual([tree,{id:'host-world-valid',kind:'world-valid'}]);
    }
  });

  it('rejects stale verification when a mutation followed scene_verify',async()=>{
    const execution=[...normalizePi(),...normalizeExecution('pi',[tool('studio_project',{operation:'run'},{status:'project-running'})])];
    const {output,mock}=await finish('pi',execution);
    expect(output.taskStatus).toBe('incomplete');
    expect(output.verification.reason).toBe('SCENE_VERIFICATION_STALE');
    expect(mock.invoked).toHaveLength(0);
  });

  it('rejects current Runtime failures and concurrent revision changes',async()=>{
    const runtime=await finish('dsh',normalizeDsh(),{verification:'unverified'});
    expect(runtime.output.taskStatus).toBe('incomplete');
    expect(runtime.output.verification.reason).toBe('SCENE_VERIFICATION_FAILED');
    const changed=await finish('pi',normalizePi(),{revision:5,after:6});
    expect(changed.output.taskStatus).toBe('incomplete');
    expect(changed.output.verification.reason).toBe('SCENE_REVISION_CHANGED');
  });

  it('requires the actual matching target even if the agent verified only world validity',async()=>{
    const execution=normalizeExecution('pi',[
      calls[0],tool('scene_verify',{criteria:[{id:'valid',kind:'world-valid'}]},
        accepted([{id:'valid',kind:'world-valid'}]))
    ]);
    const {output,mock}=await finish('pi',execution);
    expect(output.taskStatus).toBe('completed');
    expect(mock.invoked.find(call=>call.name==='scene_verify').args.criteria.some(
      check=>check.targetId==='tree'&&check.kind==='object-exists')).toBe(true);
  });

  it('distinguishes read-only tasks, empty DSH replies and failed tool calls',async()=>{
    const observe=tool('scene_observe',{}, {revision:5});
    const readOnly=await finish('dsh',normalizeExecution('dsh',[
      {type:'tool/call',data:{name:'mcp__agentscape__scene_observe',callId:'observe',arguments:'{}'}},
      {type:'tool/result',data:{message:{toolCallId:'observe',...observe.result}}}
    ]));
    expect(readOnly.output.taskStatus).toBe('no-mutation');
    expect(readOnly.mock.invoked).toHaveLength(0);
    const empty=await finish('dsh',[]);
    expect(empty.output.taskStatus).toBe('incomplete');
    const pending=normalizeExecution('dsh',[
      {type:'tool/call',data:{name:'mcp__agentscape__scene_add_model',callId:'pending',
        arguments:JSON.stringify({model:{id:'tree'}})}}
    ]);
    expect(pending[0].outcome.reason).toBe('TOOL_RESULT_MISSING');
    const failed=await finish('dsh',pending);
    expect(failed.output.verification.reason).toBe('UNRESOLVED_TOOL_FAILURE');
    expect(failed.output.verified).toBe(false);
  });

  it('refuses unbound or switched Studio sessions, including DSH re-attachment',async()=>{
    const unbound=await finalizeRun({output:{backend:'dsh',execution:normalizeDsh()},
      configuration:config,mcpConnector:fixture().connection});
    expect(unbound.verification.reason).toBe('WORLD_SESSION_UNBOUND');
    const switched=await finalizeRun({output:{backend:'dsh',execution:normalizeDsh()},
      expectedWorldSessionId:'original-session',configuration:config,mcpConnector:fixture().connection});
    expect(switched.verification.reason).toBe('WORLD_SESSION_CHANGED');
    const mismatched=await finalizeRun({output:{backend:'pi',worldSessionId:'other-session',
      execution:normalizePi()},expectedWorldSessionId:'world-session',configuration:config,
      mcpConnector:fixture().connection});
    expect(mismatched.verification.reason).toBe('WORLD_SESSION_CHANGED');
  });
  it('never classifies asset build submissions as read-only queries',async()=>{
    const execution=normalizeExecution('pi',[
      tool('asset_build_submit',{kind:'procedural'},{status:'succeeded'})
    ]);
    expect(execution[0].mutates).toBe(true);
    const {output}=await finish('pi',execution,{},{worldSessionId:'world-session'});
    expect(output.taskStatus).toBe('incomplete');
    expect(output.verification.reason).toBe('SCENE_VERIFICATION_MISSING');
  });
  it('reports a missing human approval as awaiting-approval, never as a completed mutation',async()=>{
    const execution=normalizeExecution('pi',[{
      name:'studio_project',callId:'attempt',args:{operation:'run'},
      result:result({code:'PROJECT_EXECUTION_REVIEW_REQUIRED'}),isError:true
    }]);
    expect(execution[0].outcome.reason).toBe('PROJECT_EXECUTION_REVIEW_REQUIRED');
    const {output}=await finish('pi',execution);
    expect(output.taskStatus).toBe('awaiting-approval');
    expect(output.verified).toBe(false);
    expect(output.verification.reason).toBe('PROJECT_EXECUTION_REVIEW_REQUIRED');
  });
  it('verifies a scoped project only after saving the matching running revision',async()=>{
    const project={id:'world_abc',worldSessionId:'world-session'};
    const edits=normalizeExecution('pi',[
      tool('studio_project',{operation:'write'},{status:'project-draft-saved',revision:3}),
      tool('studio_project',{operation:'run'},{status:'project-running',revision:3}),
      tool('studio_project',{operation:'save'},{status:'succeeded'})
    ]);
    const proof=normalizeExecution('pi',[tool('scene_verify',{criteria},accepted(criteria))]);
    const options={projectState:{active:true,revision:3,runningRevision:3,project:{id:project.id},observation:{project:{entities:[{id:'tree'}]}}}};
    const mock=fixture(options);
    const acceptedProject=await finalizeRun({output:{backend:'dsh',execution:[...edits,...proof]},
      project,configuration:config,mcpConnector:mock.connection});
    expect(acceptedProject.taskStatus).toBe('completed');
    expect(acceptedProject.world).toMatchObject({projectId:'world_abc',projectRevision:3});
    expect(mock.invoked.filter(item=>item.name==='studio_project')).toHaveLength(2);
    const noSave=await finalizeRun({output:{backend:'pi',execution:[...edits.slice(0,2),...proof]},
      project,configuration:config,mcpConnector:mock.connection});
    expect(noSave.verification.reason).toBe('PROJECT_NOT_SAVED');
    const changed=await finalizeRun({output:{backend:'pi',execution:[...edits,...proof]},
      project,configuration:config,mcpConnector:fixture({
        projectState:{active:true,revision:4,runningRevision:3,project:{id:project.id}}
      }).connection});
    expect(changed.verification.reason).toBe('TASK_PROJECT_CHANGED');
  });
});
