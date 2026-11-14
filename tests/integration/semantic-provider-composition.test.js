import { expect, it } from 'vitest';
import { createSession } from '../../application/createSession.js';
import { openCodeProject } from '../../application/native-scene/CodeProject.js';
import { AgentTools } from '../../application/AgentTools.js';
import { bootstrapWorld } from '../../modules/agent/bootstrapWorld.js';
import { createBlankWorld } from '../../modules/world/content/blankWorld.js';
import { ENVIRONMENTS } from '../../modules/world/content/environments.js';

async function finish(scene, job, limit = 2500) {
  for (let frame = 0; frame < limit && scene.getJob(job.id).status === 'running'; frame++) {
    scene.step();
    if (frame % 12 === 0) await new Promise(resolve => setTimeout(resolve, 0));
    else await Promise.resolve();
  }
  expect(scene.getJob(job.id).status).not.toBe('running');
  return scene.waitJob(job.id);
}

it('combines real articulated physics and project-defined semantics on one logical entity', async () => {
  const session=createSession(null,{environmentFactory:()=>createBlankWorld({id:'semantic-composition-lab'})});
  await session.world.init();
  const {world,scene}=session;
  try {
    const preset=ENVIRONMENTS.find(item=>item.id==='industrial-cabinet-lab').bootstrap;
    await bootstrapWorld(new AgentTools(world,{actor:'agent_01',profile:'builder',source:'test'}),preset);
    const target='industrial_cabinet_01',actor='agent_01';
    const record=world.store.get(target);

    expect(()=>scene.registerEntity({id:target,read:()=>({mode:'idle'})})).toThrow('PROJECT_ENTITY_CONFLICT');
    expect(()=>scene.registerEntity({id:'missing',attachTo:'runtime',read:()=>({})})).toThrow('PROJECT_ATTACHMENT_TARGET_NOT_FOUND');
    expect(()=>scene.registerEntity({id:target,attachTo:'environment',read:()=>({})})).toThrow('PROJECT_ATTACHMENT_INVALID');

    const machine=scene.registerStateMachine({
      id:target,attachTo:'runtime',initialState:{mode:'idle'},
      transitions:[
        {name:'open',effects:[{field:'mode',op:'set',value:'logical-open'}]},
        {name:'resetProgram',effects:[{field:'mode',op:'set',value:'idle'}]}
      ]
    });
    expect(world.store.get(target)).toBe(record);
    expect(world.semantic.entity(target)).toMatchObject({exists:true,source:'runtime',providers:['runtime','project']});
    expect(world.semantic.state(target,'mode')).toMatchObject({status:'known',source:'project',value:'idle'});

    const observed=scene.observe({actor});
    const inAssets=observed.affordances.entities.find(item=>item.id===target);
    const inProject=observed.project.entities.find(item=>item.id===target);
    expect(inAssets.providers).toEqual(['asset','project']);
    expect(inProject.providers).toEqual(['asset','project']);
    expect(inAssets.capabilities.some(item=>item.name==='resetProgram' && item.source==='project')).toBe(true);

    const inspect=scene.inspect(target,{actor});
    expect(inspect.source).toBe('composite');
    expect(inspect.physics.registered).toBe(true);
    expect(inspect.state).toMatchObject({mode:'idle'});
    const opens=inspect.capabilities.filter(item=>item.name==='open');
    expect(opens.some(item=>item.source==='project' && item.executor==='project-action')).toBe(true);
    expect(opens.some(item=>item.source==='asset' && item.executor==='interaction')).toBe(true);
    expect(()=>scene.interact({action:'invoke',target,actor,name:'open'})).toThrow('ACTION_SOURCE_REQUIRED');
    expect(()=>scene.interact({action:'invoke',target,actor,name:'open',source:'asset'})).toThrow('ACTION_PART_REQUIRED');

    const logical=await scene.waitJob(scene.interact({action:'invoke',target,name:'open',source:'project'}).id);
    expect(logical).toMatchObject({status:'succeeded',result:{outcome:{physicsVerified:false},verification:{status:'verified'}}});
    expect(world.physics.getArticulationState(target,'upper_drawer').coordinate).toBeCloseTo(0,1);
    expect(scene.verify([{id:'opened',kind:'interaction-verified',targetId:target,capability:'OPEN'}]).value)
      .toMatchObject({status:'world-incomplete',checks:[{reason:'INTERACTION_SOURCE_REQUIRED'}]});
    expect(scene.verify([{id:'logical',kind:'interaction-verified',targetId:target,capability:'OPEN',source:'project'}]).value.status).toBe('world-accepted');
    expect(scene.verify([{id:'physical',kind:'interaction-verified',targetId:target,capability:'OPEN',source:'asset'}]).value.status).toBe('world-incomplete');

    const physical=await finish(scene,scene.interact({
      action:'invoke',target,actor,name:'open',source:'asset',partName:'upper_drawer'
    }));
    expect(physical).toMatchObject({status:'succeeded',result:{outcome:{physicsVerified:true},verification:{status:'verified'}}});
    expect(world.physics.getArticulationState(target,'upper_drawer').coordinate).toBeCloseTo(.45,1);
    expect(scene.verify([{id:'physical',kind:'interaction-verified',targetId:target,capability:'OPEN',source:'asset'}]).value.status).toBe('world-accepted');
    expect(scene.verify([{id:'logical',kind:'interaction-verified',targetId:target,capability:'OPEN',source:'project'}]).value.status).toBe('world-accepted');

    // Two providers can report a field with the same name without overwriting one another.
    record.state.mode='physical-only';
    expect(world.semantic.state(target,'mode')).toMatchObject({status:'unknown',reason:'STATE_PROVIDER_CONFLICT',
      source:'multiple',providers:['runtime','project']});
    expect(world.semantic.state(target,'mode',{source:'runtime'})).toMatchObject({status:'known',value:'physical-only'});
    expect(world.semantic.state(target,'mode',{source:'project'})).toMatchObject({status:'known',value:'logical-open'});
    expect(scene.inspect(target).stateConflicts).toContain('mode');
    expect(scene.inspect(target).state).toMatchObject({mode:'physical-only'});
    expect(scene.inspect(target).stateProviders.project.mode).toBe('logical-open');
    expect(scene.verify([{id:'mode',kind:'state-equals',targetId:target,stateKey:'mode',value:'logical-open'}]).value)
      .toMatchObject({status:'world-incomplete',checks:[{truth:'unknown',reason:'STATE_PROVIDER_CONFLICT'}]});
    expect(scene.verify([{id:'mode',kind:'state-equals',targetId:target,stateKey:'mode',value:'logical-open',source:'project'}]).value.status).toBe('world-accepted');
    machine.dispose();
    expect(scene.inspect(target).providers).toBeUndefined();
    expect(world.store.get(target)).toBe(record);
  } finally {scene.close();world.dispose();}
},90000);

it('prevents stale project actions after their physical target is deleted',async()=>{
  const session=createSession(null,{environmentFactory:()=>createBlankWorld({id:'semantic-attachment-lifecycle'})});
  await session.world.init();
  const {scene,world}=session;
  try {
    await scene.addModel({id:'device_01',asset:'builtin://table',position:[0,0,0]});
    const release=scene.registerEntity({id:'device_01',attachTo:'runtime',read:()=>({powered:true})});
    const original=world.store.get('device_01').object;
    let received=null;
    scene.registerAction({target:'device_01',name:'reboot',execute:(_args,context)=>{received=context.object;return {done:true};},
      verify:()=>({verified:true})});
    const first=await scene.waitJob(scene.interact({action:'invoke',target:'device_01',name:'reboot',source:'project'}).id);
    expect(first.result.verification.status).toBe('verified');
    expect(received).toBe(original);
    // Replacing an asset keeps its logical ID but creates a different Runtime instance.
    // The previously registered project behavior must not silently rebind.
    await scene.replaceAsset({id:'device_01',asset:'builtin://table'});
    expect(world.store.get('device_01').object).not.toBe(original);
    expect(world.semantic.state('device_01','powered')).toMatchObject({status:'unknown',reason:'STATE_NOT_OBSERVED'});
    expect(scene.inspect('device_01').state).not.toHaveProperty('powered');
    expect(scene.inspect('device_01').capabilities.find(item=>item.name==='reboot')).toMatchObject({
      available:false,reason:'PROJECT_ATTACHMENT_TARGET_MISSING'
    });
    await scene.remove({id:'device_01'});
    expect(world.semantic.entity('device_01')).toMatchObject({exists:false,reason:'PROJECT_ATTACHMENT_TARGET_MISSING'});
    expect(world.semantic.state('device_01','powered')).toMatchObject({status:'unknown',reason:'PROJECT_ATTACHMENT_TARGET_MISSING'});
    expect(scene.inspect('device_01').capabilities.find(item=>item.name==='reboot')).toMatchObject({
      available:false,reason:'PROJECT_ATTACHMENT_TARGET_MISSING'
    });
    const failed=await scene.waitJob(scene.interact({action:'invoke',target:'device_01',name:'reboot',source:'project'}).id);
    expect(failed).toMatchObject({status:'failed',result:{diagnostics:[{code:'PROJECT_ATTACHMENT_TARGET_MISSING'}]}});
    expect(scene.verify([{id:'exists',kind:'object-exists',targetId:'device_01'}]).value.status).toBe('world-incomplete');
    release();
    expect(()=>scene.inspect('device_01')).toThrow('OBJECT_NOT_FOUND');
  } finally {scene.close();world.dispose();}
},30000);

it('restores a Code Project state machine attached to an actual Runtime asset',async()=>{
  const source = [
    'export function createProject({THREE}) {',
    '  const scene=new THREE.Scene();',
    '  const camera=new THREE.PerspectiveCamera(55,1,.1,100);',
    '  const renderer={render(){},extensions:{has:()=>false},dispose(){}};',
    '  return {scene,camera,renderer,async setup({scene:api,world}) {',
    "    if(!world.store.has('device_01')) await api.addModel({id:'device_01',asset:'builtin://table',position:[0,0,0]});",
    "    api.registerStateMachine({id:'device_01',attachTo:'runtime',",
    "      initialState:{power:'off'},transitions:[",
    "        {name:'energize',when:[{field:'power',op:'eq',value:'off'}],effects:[{field:'power',op:'set',value:'on'}]},",
    "        {name:'turnOff',when:[{field:'power',op:'eq',value:'on'}],effects:[{field:'power',op:'set',value:'off'}]}",
    "      ]});",
    '  },dispose(){}};',
    '}'
  ].join('\n');
  const project={schema:'agentscape.code-project',schemaVersion:1,id:'provider-union',name:'Provider composition',source,resources:{}};
  const session=await openCodeProject({project,authorized:true,autoStart:false});
  let reopened;
  try {
    expect(session.world.store.has('device_01')).toBe(true);
    const initial=session.scene.inspect('device_01');
    expect(initial.providers).toEqual(['asset','project']);
    expect(initial.state.power).toBe('off');
    expect(initial.capabilities.find(cap=>cap.name==='energize')).toMatchObject({source:'project',executor:'project-action'});
    expect(initial.capabilities.some(cap=>cap.name==='push' && cap.source==='asset')).toBe(true);

    const done=await session.scene.waitJob(session.scene.interact({
      action:'invoke',target:'device_01',name:'energize'
    }).id);
    expect(done).toMatchObject({status:'succeeded',result:{verification:{status:'verified'}}});
    const saved=(await session.save()).value;
    expect(saved.machines.entities.device_01).toMatchObject({power:'on'});
    session.close();

    reopened=await openCodeProject({project:saved,authorized:true,autoStart:false});
    expect(reopened.world.store.has('device_01')).toBe(true);
    expect(reopened.scene.inspect('device_01')).toMatchObject({
      source:'composite',state:{power:'on'},providers:['asset','project']
    });
    expect(reopened.world.semantic.state('device_01','power')).toMatchObject({source:'project',status:'known',value:'on'});
    expect(reopened.scene.verify([{id:'power',kind:'state-equals',targetId:'device_01',stateKey:'power',value:'on'}]).value.status)
      .toBe('world-accepted');
    expect(reopened.scene.verify([{id:'historical',kind:'interaction-verified',targetId:'device_01',capability:'ENERGIZE',source:'project'}]).value.status)
      .toBe('world-incomplete');
    const off=await reopened.scene.waitJob(reopened.scene.interact({
      action:'invoke',target:'device_01',name:'turnOff',source:'project'
    }).id);
    expect(off).toMatchObject({status:'succeeded',result:{verification:{status:'verified'}}});
    expect(reopened.scene.inspect('device_01').state.power).toBe('off');
  } finally {session.close();reopened?.close();}
},30000);
