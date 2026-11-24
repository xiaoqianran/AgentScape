import { describe,it,expect } from 'vitest';
import { compileTaskSpec,requiredTaskCriteria,GOLDEN_TASKS } from '../../apps/agent-host/TaskSpec.js';
import { finalizeRun } from '../../apps/agent-host/AgentRunFinalizer.js';
import { normalizeExecution } from '../../apps/agent-host/AgentExecution.js';

const response=value=>({content:[{type:'text',text:JSON.stringify(value)}]});
const userChecks=[{id:'model-world',kind:'world-valid'}];
const originalExecution=normalizeExecution('pi',[
  {name:'scene_apply',callId:'create',args:{operations:[]},
    result:response({status:'succeeded'})},
  {name:'scene_verify',callId:'verify',args:{criteria:userChecks},
    result:response({schema:'agentscape.scene-result',operation:'verify',status:'succeeded',
      verification:{status:'verified',evidence:{status:'world-accepted',
        checks:[{id:'model-world',kind:'world-valid',verified:true}]}}})}
]);
function live({objects=[],actions=[],relations=[]}={}){
  const invocations=[];
  return {invocations,connect:async()=>({
    worldSessionId:'world-task',
    tools:['scene_observe','scene_verify'].map(name=>({name,execute:async(_id,args)=>{
      invocations.push({name,args});
      if(name==='scene_observe') return response({revision:8});
      const checks=args.criteria.map(check=>{
        const verified=check.kind==='world-valid' ||
          (check.kind==='object-exists'&&objects.includes(check.targetId)) ||
          (check.kind==='interaction-verified'&&actions.includes(check.targetId+'.'+check.capability)) ||
          (check.kind==='relation-exists'&&relations.includes(check.subject+'.'+check.predicate+'.'+check.object));
        if(check.kind==='interaction-verified')return {...check,expected:check.capability,verified,
          ...(verified?{evidence:{schema:'agentscape.interaction-evidence',schemaVersion:1,verified:true,
            worldRevisionId:'session:test-runtime',targetId:check.targetId,capability:check.capability,
            source:check.source==='project'?'project-defined':check.source}}:{reason:'INTERACTION_NOT_VERIFIED'})};
        return {...check,verified};
      });
      return response({schema:'agentscape.scene-result',operation:'verify',status:'succeeded',
        revision:8,verification:{status:checks.every(check=>check.verified)?'verified':'unverified',
          evidence:{status:checks.every(check=>check.verified)?'world-accepted':'world-incomplete',checks}}});
    }})),
    close:async()=>{}
  })};
}
async function verify(goal,scene){
  const spec=compileTaskSpec(goal),connection=live(scene);
  const result=await finalizeRun({output:{backend:'pi',worldSessionId:'world-task',execution:originalExecution},
    taskSpec:spec,expectedWorldSessionId:'world-task',
    configuration:{mcpUrl:'http://127.0.0.1/unused',mcpToken:'test'},mcpConnector:connection.connect});
  return {spec,result,invocations:connection.invocations};
}

describe('TaskSpec user-owned acceptance and golden tasks',()=>{
  it('freezes canonical requirements for each of the three golden tasks',()=>{
    const [apples,house,cup]=GOLDEN_TASKS.map(entry=>compileTaskSpec(entry.prompt));
    expect([apples,house,cup].map(value=>value.template)).toEqual(['apple-tree','house','cup']);
    expect(apples.requiredChecks.map(item=>item.targetId).filter(Boolean)).toEqual([
      'apple_tree','apple_01','apple_02','apple_03','apple_04','apple_05','apple_tree'
    ]);
    expect(apples.requiredChecks.at(-1)).toMatchObject({kind:'interaction-verified',capability:'PLUCK'});
    expect(house.requiredChecks.map(item=>item.targetId)).toEqual(['house','door_01','window_01','stairs']);
    expect(cup.requiredChecks.at(-1)).toMatchObject({kind:'relation-exists',
      subject:'cup_01',predicate:'ON',object:'table_01'});
    expect(compileTaskSpec(GOLDEN_TASKS[0].prompt).id).toBe(apples.id);
    expect(requiredTaskCriteria(apples)).toEqual(apples.requiredChecks);
  });

  it('a model-only world-valid check cannot complete five-apples user request',async()=>{
    const {result,invocations}=await verify(GOLDEN_TASKS[0].prompt,{
      objects:['apple_tree'],actions:[]
    });
    expect(result.taskStatus).toBe('incomplete');
    expect(result.verification.reason).toBe('SCENE_VERIFICATION_FAILED');
    expect(invocations.find(item=>item.name==='scene_verify').args.criteria)
      .toEqual(expect.arrayContaining([
        expect.objectContaining({id:'task-entity-apple_05',targetId:'apple_05'}),
        expect.objectContaining({capability:'PLUCK'})
      ]));
  });

  it('accepts complete user criteria, while preserving unavailable visual review',async()=>{
    const apples=await verify(GOLDEN_TASKS[0].prompt,{
      objects:['apple_tree','apple_01','apple_02','apple_03','apple_04','apple_05'],
      actions:['apple_tree.PLUCK']
    });
    expect(apples.result.taskStatus).toBe('completed');
    expect(apples.result.taskSpec.id).toBe(apples.spec.id);
    const visual=await verify('创建漂亮的苹果树，带5个苹果，可以摘取',{
      objects:['apple_tree','apple_01','apple_02','apple_03','apple_04','apple_05'],
      actions:['apple_tree.PLUCK']
    });
    expect(visual.result.taskStatus).toBe('incomplete');
    expect(visual.result.verification.reason).toBe('VISUAL_REVIEW_PENDING');
  });

  it('independently checks house parts and cup placement in live conditions',async()=>{
    const house=await verify(GOLDEN_TASKS[1].prompt,{objects:['house','door_01','window_01','stairs']});
    expect(house.result.taskStatus).toBe('completed');
    const incompleteCup=await verify(GOLDEN_TASKS[2].prompt,{objects:['cup_01','table_01']});
    expect(incompleteCup.result.taskStatus).toBe('incomplete');
    const cup=await verify(GOLDEN_TASKS[2].prompt,{
      objects:['cup_01','table_01'],relations:['cup_01.ON.table_01']
    });
    expect(cup.result.taskStatus).toBe('completed');
  });

  it('unrecognized tasks and excessive fruit counts cannot be silently approved',async()=>{
    for(const prompt of ['สร้างภูเขา','创建一棵有20个苹果的苹果树','建造带电梯的房屋','建一棵会唱歌的苹果树']){
      const {spec,result,invocations}=await verify(prompt,{});
      expect(spec.status).toBe('review-required');
      expect(result.taskStatus).toBe('incomplete');
      expect(result.verification.reason).toBe(spec.reason);
      expect(invocations).toHaveLength(0);
    }
  });

  it('never presents no-mutation as success when user requested an unfulfilled construction',async()=>{
    const {result}=await verify('在当前世界添加苹果树',{});
    expect(result.taskStatus).toBe('incomplete');
    const spec=compileTaskSpec(GOLDEN_TASKS[0].prompt);
    const noTools=await finalizeRun({
      output:{backend:'pi',taskStatus:'no-mutation',message:'Done',worldSessionId:'world-task',execution:[]},
      taskSpec:spec,expectedWorldSessionId:'world-task',
      configuration:{mcpUrl:'http://localhost',mcpToken:'test'},mcpConnector:live().connect
    });
    expect(noTools.taskStatus).toBe('incomplete');
    expect(noTools.verification.reason).toBe('TASK_REQUIRED_MUTATION_MISSING');
  });
  it('the model cannot weaken required criteria by forging a task-* check id',async()=>{
    const spec=compileTaskSpec(GOLDEN_TASKS[0].prompt);
    const forged=normalizeExecution('pi',[
      originalExecution[0] ? {
        name:'scene_apply',callId:'create',args:{operations:[]},
        result:response({status:'succeeded'})
      } : {},
      {name:'scene_verify',callId:'verify',args:{criteria:[
        {id:'task-entity-apple_05',kind:'world-valid'}]},
        result:response({schema:'agentscape.scene-result',operation:'verify',status:'succeeded',
          verification:{status:'verified',evidence:{status:'world-accepted',checks:[
            {id:'task-entity-apple_05',kind:'world-valid',verified:true}
          ]}}})}
    ]);
    const connection=live({objects:['apple_tree']});
    const result=await finalizeRun({output:{backend:'pi',worldSessionId:'world-task',execution:forged},
      taskSpec:spec,expectedWorldSessionId:'world-task',
      configuration:{mcpUrl:'http://localhost',mcpToken:'test'},mcpConnector:connection.connect});
    expect(result.taskStatus).toBe('incomplete');
    expect(connection.invocations.find(item=>item.name==='scene_verify').args.criteria)
      .toEqual(expect.arrayContaining([{id:'task-entity-apple_05',kind:'object-exists',targetId:'apple_05'}]));
  });
});
