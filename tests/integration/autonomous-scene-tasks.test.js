import {it,expect} from 'vitest';
import {createSession} from '../../application/createSession.js';
import {AgentTools} from '../../application/AgentTools.js';
import {ToolCallingAgent} from '../../modules/agent/ToolCallingAgent.js';
import {createMonumentHall} from '../../modules/world/content/monumentHall.js';
import {createCabinAffordances} from '../../modules/world/content/magic-cabin/affordances.js';

async function fixture() {
  const session=createSession(null,{environmentFactory:()=>createMonumentHall({loadAssets:false})});
  await session.world.init();return session;
}
async function pump(scene,promise,onTick=()=>{}) {
  let done=false,value,error;
  promise.then(result=>{done=true;value=result;},failure=>{done=true;error=failure;});
  for(let n=0;n<15000&&!done;n++){scene.step();onTick();if(n%12===0)await new Promise(resolve=>setTimeout(resolve,0));else await Promise.resolve();}
  if(error)throw error;expect(done).toBe(true);return value;
}
const response=(name,args)=>({message:'依据当前关系规划下一步',toolCalls:[{id:crypto.randomUUID(),name,args}]});
const blocker={schema:'agentscape.asset-recipe',schemaVersion:1,id:'fixture/blocker',parts:[{id:'body',position:[0,.3,0],geometry:{type:'box',size:[2.4,.6,1.3]}}],
  capabilities:{level:'physical',physics:{body:'fixed',mass:1,friction:.5,colliders:[{shape:'box',halfExtents:[1.2,.3,.65],translation:[0,.3,0]}]}}};

// Deterministic planner fixture tests the production loop, not online LLM quality.
it.each([['north',1],['west',-1]])('tidies multiple discovered objects with changed IDs/layout (%s), recovering from an occupied support',async(prefix,sign)=>{
  const {scene,world}=await fixture();
  try {
    const actor=`${prefix}_worker`;
    await scene.addModel({id:actor,asset:'builtin://agent',position:[0,0,3]});
    for(const [index,x] of [sign*1,sign*2].entries())await scene.addModel({id:`${prefix}_loose_${index}`,asset:'builtin://cup',position:[x,0,1]});
    await scene.addModel({id:`${prefix}_occupied`,asset:'builtin://table',position:[sign*3,0,0]});
    await scene.addModel({id:`${prefix}_clear`,asset:'builtin://table',position:[-sign*3,0,0]});
    await scene.addModel({id:`${prefix}_obstruction`,asset:blocker,position:[sign*3,1.1,0]});
    for(let n=0;n<30;n++)scene.step();
    let rounds=0,failed=false;
    const gateway={isConfigured:()=>true,complete:async request=>{
      rounds++;
      const live=request.context.scene;
      expect(live).toBeTruthy();
      const objects=live.objects.filter(object=>object.type==='cup');
      const supports=live.objects.filter(object=>object.type==='table').map(object=>object.id);
      if(!request.context.task.plan)return response('planSceneTask',{criteria:objects.map(object=>({id:object.id,kind:'relation-exists',subject:object.id,predicate:'ON',objectAnyOf:supports}))});
      const checks=request.context.task.plan.verification.checks,pending=checks.find(check=>!check.verified);
      if(!pending)return {message:'整理完成',toolCalls:[]};
      const held=request.context.task.actor.carry?.targetId;
      const last=request.context.task.lastMutation;
      if(last?.outcome?.verified===false && last.args?.interaction?.action==='place')failed=true;
      const interaction=held ? {actor,action:'place',target:failed?supports[1]:supports[0],surfaceId:'top'}
        : {actor,action:'pickup',target:pending.subject};
      return response('interactScene',{goalId:pending.id,interaction});
    }};
    const agent=new ToolCallingAgent({tools:new AgentTools(world,{actor}),gateway,maxSteps:20});
    const result=await pump(scene,agent.run('整理这间房间'));
    expect(result,JSON.stringify(result)).toMatchObject({taskStatus:'completed',goalVerification:{status:'world-accepted'},unresolvedMutations:[]});
    expect(failed).toBe(true);expect(rounds).toBeGreaterThan(5);
    expect(result.execution.some(entry=>entry.executed && entry.outcome.state==='failed')).toBe(true);
    for(const object of world.store.list().filter(([,record])=>record.manifest.type==='cup'))expect(world.sceneGraph.list({subject:object[0],predicate:'ON'}).some(edge=>edge.object===`${prefix}_clear`)).toBe(true);
  }finally{scene.close();world.dispose();}
});

it('approaches an environment contract with real navigation and verifies its native state',async()=>{
  const {scene,world}=await fixture();
  try {
    await scene.addModel({id:'worker',asset:'builtin://agent'});
    let on=false;
    world.environment.affordances=createCabinAffordances({hinges:[],texts:[],drawers:[],books:[],switches:[{id:'room:light',position:[4,1.2,0],get:()=>on,set:value=>{on=value;}}]});
    expect(scene.inspect('room:light',{actor:'worker'}).actions[0]).toMatchObject({available:false,canApproach:true});
    const job=scene.interact({actor:'worker',target:'room:light',action:'turn_on'});
    const result=await pump(scene,scene.waitJob(job.id));
    expect(result,JSON.stringify(result)).toMatchObject({status:'succeeded',result:{value:{verified:true,physicsVerified:false,navigationInvalidated:true}}});
    expect(world.physics.getPosition('worker')[0]).toBeGreaterThan(1);
    expect(on).toBe(true);
  }finally{scene.close();world.dispose();}
});

it('requires a choice for multiple Agents and preserves the selected actor across observations',async()=>{
  const {scene,world}=await fixture();
  try {
    await scene.addModel({id:'worker_b',asset:'builtin://agent'});
    expect(scene.actors().selected).toBe('worker_b');
    await scene.addModel({id:'worker_a',asset:'builtin://agent',position:[3,0,0]});
    expect(scene.actors().selected).toBeNull();
    scene.selectActor('worker_a');expect(scene.observe().actors.selected).toBe('worker_a');
    await scene.remove({id:'worker_a'});expect(scene.actors().selected).toBe('worker_b');
  }finally{scene.close();world.dispose();}
});

async function lampFixture() {
  const session=await fixture();await session.scene.addModel({id:'worker',asset:'builtin://agent'});
  let on=false;
  session.world.environment.affordances=createCabinAffordances({hinges:[],texts:[],drawers:[],books:[],switches:[{id:'room:light',position:[4,1.2,0],get:()=>on,set:value=>{on=value;}}]});
  return {...session,isOn:()=>on};
}
const lampGoal={id:'light',kind:'state-equals',targetId:'room:light',stateKey:'on',value:true};

it('refuses a weakened goal and never accepts a model-only success claim',async()=>{
  const {scene,world,isOn}=await lampFixture();
  try {
    let round=0;
    const agent=new ToolCallingAgent({tools:new AgentTools(world,{actor:'worker'}),gateway:{isConfigured:()=>true,complete:async()=>{
      round++;
      if(round===1)return response('planSceneTask',{criteria:[lampGoal]});
      if(round===2)return response('planSceneTask',{criteria:[{...lampGoal,value:false}]});
      return {message:'全部整理完成',toolCalls:[]};
    }}});
    const result=await pump(scene,agent.run('整理房间并打开灯'));
    expect(result).toMatchObject({taskStatus:'incomplete',goalVerification:{failedCount:1}});
    expect(result.message).toContain('任务未完成');expect(isOn()).toBe(false);
    expect(result.execution.some(entry=>entry.reason==='TASK_PLAN_IMMUTABLE')).toBe(true);
  }finally{scene.close();world.dispose();}
});

it('bounds identical failures without erasing the unresolved goal',async()=>{
  const {scene,world}=await lampFixture();
  try {
    await scene.addModel({id:'immovable',asset:'builtin://chair',position:[2,0,0]});
    let round=0;
    const agent=new ToolCallingAgent({tools:new AgentTools(world,{actor:'worker'}),maxSteps:6,gateway:{isConfigured:()=>true,complete:async()=>++round===1
      ? response('planSceneTask',{criteria:[lampGoal]})
      : response('interactScene',{goalId:'light',interaction:{actor:'worker',target:'immovable',action:'push',args:{direction:[1,0,0],distance:1}}})}});
    const result=await pump(scene,agent.run('整理房间'));
    expect(result).toMatchObject({taskStatus:'incomplete',termination:'planning-limit'});
    expect(result.execution.filter(entry=>entry.tool==='interactScene'&&entry.executed).length).toBe(2);
    expect(result.execution.some(entry=>entry.reason==='UNCHANGED_FAILURE_LIMIT')).toBe(true);
    expect(result.unresolvedMutations).toHaveLength(1);
  }finally{scene.close();world.dispose();}
});

it('cancels while approaching an environment contract and prevents late activation',async()=>{
  const {scene,world,isOn}=await lampFixture(),controller=new AbortController();
  try {
    let round=0;
    const agent=new ToolCallingAgent({tools:new AgentTools(world,{actor:'worker'}),gateway:{isConfigured:()=>true,complete:async()=>++round===1
      ? response('planSceneTask',{criteria:[lampGoal]})
      : response('interactScene',{goalId:'light',interaction:{actor:'worker',target:'room:light',action:'turn_on'}})}});
    const result=await pump(scene,agent.run('开灯',{signal:controller.signal}),()=>{if(world.locomotion.tasks.size)controller.abort();});
    expect(result.taskStatus).toBe('cancelled');expect(isOn()).toBe(false);
    for(let n=0;n<60;n++)scene.step();expect(isOn()).toBe(false);
    expect(world.locomotion.tasks.size).toBe(0);expect(world.affordances.pending.size).toBe(0);
  }finally{scene.close();world.dispose();}
});

it('refuses an occluded environment target instead of activating through a collider',async()=>{
  const {scene,world,isOn}=await lampFixture();
  try {
    const wall={...blocker,id:'fixture/wall',parts:[{id:'body',position:[0,1.5,0],geometry:{type:'box',size:[1,3,1]}}],
      capabilities:{level:'physical',physics:{body:'fixed',mass:1,friction:.5,colliders:[{shape:'box',halfExtents:[.5,1.5,.5],translation:[0,1.5,0]}]}}};
    await scene.addModel({id:'sealed',asset:wall,position:[4,0,0]});
    const job=scene.interact({actor:'worker',target:'room:light',action:'turn_on'});
    const result=await pump(scene,scene.waitJob(job.id));
    expect(result).toMatchObject({status:'failed',result:{value:{reason:'NO_APPROACH_POSE',verified:false}}});expect(isOn()).toBe(false);
  }finally{scene.close();world.dispose();}
});

it('rejects cyclic dependencies and prevents a dependent action until its prerequisite is verified',async()=>{
  const {scene,world,isOn}=await lampFixture();
  try {
    const tools=new AgentTools(world,{actor:'worker'});
    const criteria=[lampGoal,{...lampGoal,id:'later',value:false}];
    await expect(tools.call('planSceneTask',{criteria,dependencies:{light:['later'],later:['light']}})).rejects.toThrow('TASK_DEPENDENCY_CYCLE');
    let round=0;
    const agent=new ToolCallingAgent({tools,gateway:{isConfigured:()=>true,complete:async()=>++round===1
      ? response('planSceneTask',{criteria,dependencies:{later:['light']}})
      : round===2 ? response('interactScene',{goalId:'later',interaction:{actor:'worker',target:'room:light',action:'turn_on'}})
      : {message:'完成',toolCalls:[]}}});
    const result=await pump(scene,agent.run('按依赖操作'));
    expect(result.taskStatus).toBe('incomplete');expect(isOn()).toBe(false);
    expect(result.execution.some(entry=>entry.reason==='TASK_DEPENDENCY_UNSATISFIED')).toBe(true);
  }finally{scene.close();world.dispose();}
});

it('revalidates the live world after model latency before accepting a final success claim',async()=>{
  const {scene,world}=await lampFixture();
  try {
    let round=0;
    const tools=new AgentTools(world,{actor:'worker'});
    const agent=new ToolCallingAgent({tools,gateway:{isConfigured:()=>true,complete:async()=>{
      if(++round===1)return response('planSceneTask',{criteria:[{...lampGoal,value:false}]});
      // A concurrent environmental change while the model is responding invalidates the earlier observation.
      world.affordances.get('room:light').request('turn_on',{});
      return {message:'完成',toolCalls:[]};
    }}});
    const result=await pump(scene,agent.run('保持关灯'));
    expect(result).toMatchObject({taskStatus:'incomplete',goalVerification:{failedCount:1}});
  }finally{scene.close();world.dispose();}
});
