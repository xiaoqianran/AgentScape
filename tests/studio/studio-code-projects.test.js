import { describe, it, expect } from 'vitest';
import { StudioCodeProjects } from '../../apps/studio/code-project/StudioCodeProjects.js';
import { AuthoringWorldStore } from '../../apps/studio/persistence/AuthoringWorldStore.js';
import { openCodeProject } from '../../application/native-scene/CodeProject.js';
import { AgentTools } from '../../application/AgentTools.js';
import { ToolCallingAgent } from '../../modules/agent/ToolCallingAgent.js';

const source = `export function createProject({THREE,state}) {
 let value=state?.value ?? 1;
 return {scene:new THREE.Scene(),camera:new THREE.PerspectiveCamera(),renderer:{render(){},extensions:{has:()=>false}},
 setup({scene}) { scene.registerEntity({id:'counter',read:()=>({value})});
 scene.registerAction({target:'counter',name:'increment',execute(){value++;},verify({before,after}){return after.value===before.value+1;}}); },
 serialize(){return {value};},restore(s){value=s.value;}};
}`;
const project = {schema:'agentscape.code-project',schemaVersion:1,id:'counter_world',name:'Counter',source,resources:{}};
const open = options => openCodeProject({...options,autoStart:false});
async function fixture(store = new AuthoringWorldStore({indexedDBImpl:null})) {
 const base=await open({project:{...project,id:'base'},authorized:true});
 const controller=new StudioCodeProjects({baseWorld:base.world,baseScene:base.scene,store,open});
 return {base,controller,tools:controller.wrapTools(new AgentTools(base.world)),close(){controller.dispose();base.close();}};
}

describe('Studio complete code project ownership',()=>{
 it('routes tools to the visible instance, retains state across edits, persists and reopens in another controller',async()=>{
  const f=await fixture();let other;
  try {
   await f.controller.write({create:true,project});await f.controller.run();
   expect(f.tools.runtime).toBe(f.controller.session.world);
   await f.tools.call('interactScene',{interaction:{action:'custom',target:'counter',name:'increment'}});
   expect(f.controller.scene.inspect('counter').state.value).toBe(2);
   await f.controller.write({expectedRevision:1,source:source.replace('value++;','value+=2;')});
   await expect(f.controller.save()).rejects.toThrow('RUN_DRAFT_BEFORE_SAVE');
   await f.controller.run({expectedRevision:2});
   expect(f.controller.scene.inspect('counter').state.value).toBe(2);
   const action=await f.tools.call('interactScene',{interaction:{action:'custom',target:'counter',name:'increment'}});
   expect(action.verification.status).toBe('unverified'); // New execute no longer meets old verifier.
   const saved=await f.tools.call('saveStudioProject');
   expect(saved.value.state.value).toBe(4);
   other=await fixture(f.controller.store);
   await other.controller.load(project.id);await other.controller.run();
   expect(other.controller.scene.inspect('counter').state.value).toBe(4);
   expect(other.controller.draft.source).toContain('value+=2;');
   await f.controller.close();expect(f.tools.runtime).toBe(f.base.world);
  } finally {other?.close();f.close();}
 },30000);
 it('keeps the old session on syntax/setup failure, rejects stale edits and prevents replacement during actions',async()=>{
  const f=await fixture();
  try {
   await f.controller.write({create:true,project});await f.controller.run();const active=f.controller.session;
   await expect(f.controller.write({source:'bad',expectedRevision:0})).rejects.toThrow('PROJECT_REVISION_CONFLICT');
   await f.controller.write({source:'syntax error !!!',expectedRevision:1});
   await expect(f.controller.run()).rejects.toThrow();expect(f.controller.session).toBe(active);
   let release;
   active.scene.registerAction({target:'counter',name:'wait',execute:()=>new Promise(resolve=>{release=resolve;})});
   const job=active.scene.interact({action:'custom',target:'counter',name:'wait'});await Promise.resolve();
   await expect(f.controller.close()).rejects.toThrow('SCENE_BUSY');
   await expect(f.controller.run()).rejects.toThrow('SCENE_BUSY');
   release();await active.scene.waitJob(job.id);
   await f.controller.close();
   expect((await f.controller.store.load(project.id)).document.project).toMatchObject({source:'syntax error !!!',state:{value:1}});
  }finally{f.close();}
 },30000);
 it('preserves the previous session when replacement observation fails',async()=>{
  const f=await fixture();
  try {
   await f.controller.write({create:true,project});
   await f.controller.run();
   const previous=f.controller.session;
   f.controller.open=async options=>{
    const next=await open(options);
    next.scene.observe=()=>{throw new Error('observation failed');};
    return next;
   };
   await expect(f.controller.run()).rejects.toThrow('observation failed');
   expect(f.controller.session).toBe(previous);
   expect(f.controller.snapshot().active).toBe(true);
   expect(f.controller.busy).toBe(false);
   expect(f.controller.scene.inspect('counter').state.value).toBe(1);
  } finally {f.close();}
 },30000); it('rolls back project runtime and tools if activation fails',async()=>{
  const f=await fixture();
  try {
   await f.controller.write({create:true,project});
   await f.controller.run();
   const previous=f.controller.session, originalTools=f.controller.activeTools;
   let visible=previous, failOnce=true;
   f.controller.onActivate=session=>{
    visible=session;
    if(failOnce && session!==previous) {failOnce=false;throw new Error('view activation failed');}
   };
   await expect(f.controller.run()).rejects.toThrow('view activation failed');
   expect(f.controller.session).toBe(previous);
   expect(f.controller.activeTools).toBe(originalTools);
   expect(f.tools.runtime).toBe(previous.world);
   expect(visible).toBe(previous);
   expect(f.controller.scene.inspect('counter').state.value).toBe(1);
  }finally{f.close();}
 },30000);

 it('preserves the running project when closing the editor view fails',async()=>{
  const f=await fixture();
  try {
   await f.controller.write({create:true,project});
   await f.controller.run();
   const previous=f.controller.session;
   let visible=previous;
   f.controller.onActivate=session=>{
    visible=session;
    if(session===null) throw new Error('close view failed');
   };
   await expect(f.controller.close()).rejects.toThrow('close view failed');
   expect(f.controller.session).toBe(previous);
   expect(f.controller.snapshot().active).toBe(true);
   expect(f.controller.busy).toBe(false);
   expect(visible).toBe(previous);
   expect(f.controller.scene.inspect('counter').state.value).toBe(1);
  }finally{f.close();}
 },30000);
 it('restores the old session if releasing it fails during replacement',async()=>{
  const f=await fixture();
  try {
   await f.controller.write({create:true,project});
   await f.controller.run();
   const previous=f.controller.session;
   const originalClose=previous.close;
   let active=previous;
   f.controller.onActivate=session=>{active=session;};
   previous.close=()=>{throw new Error('old close failed');};
   try {
    await expect(f.controller.run()).rejects.toThrow('old close failed');
    expect(f.controller.session).toBe(previous);
    expect(active).toBe(previous);
    expect(f.controller.scene.inspect('counter').state.value).toBe(1);
   }finally{previous.close=originalClose;}
  }finally{f.close();}
 },30000);

 it('restores the project view when closing its session fails',async()=>{
  const f=await fixture();
  try {
   await f.controller.write({create:true,project});
   await f.controller.run();
   const previous=f.controller.session;
   const originalClose=previous.close;
   let active=previous;
   f.controller.onActivate=session=>{active=session;};
   previous.close=()=>{throw new Error('project close failed');};
   try {
    await expect(f.controller.close()).rejects.toThrow('project close failed');
    expect(f.controller.session).toBe(previous);
    expect(active).toBe(previous);
    expect(f.controller.snapshot().active).toBe(true);
   }finally{previous.close=originalClose;}
  }finally{f.close();}
 },30000);
 it('executes the actual AI loop to create, run, discover, invoke, edit, rerun and save a world',async()=>{
  const f=await fixture();let round=0;
  const steps=[
   ['readStudioProject',{}],['writeStudioProject',{create:true,source,name:'AI world'}],['runStudioProject',{}],
   ['planSceneTask',{criteria:[{id:'changed',kind:'state-equals',targetId:'counter',stateKey:'value',value:2}]}],
   ['interactScene',{goalId:'changed',interaction:{action:'custom',target:'counter',name:'increment'}}],
   ['patchStudioProject',{oldText:'serialize(){',newText:'// Edited by AI\n serialize(){',expectedRevision:1}],['runStudioProject',{}],['saveStudioProject',{}]
  ];
  try {
   const agent=new ToolCallingAgent({tools:f.tools,maxSteps:12,gateway:{isConfigured:()=>true,complete:async request=>{
    if(round===3)expect(request.context.scene.project.entities[0].actions[0].name).toBe('increment');
    if(round===3)expect(request.tools.map(t=>t.name)).not.toContain('runWorldPipeline');
    const step=steps[round++];return step?{toolCalls:[{id:'call'+round,name:step[0],args:step[1]}]}:{message:'Saved',toolCalls:[]};
   }}});
   const result=await agent.run('Create a world, increment, modify the source, run and save');
   expect(result.taskStatus).toBe('completed');
   expect(result.execution.filter(e=>e.executed).map(e=>e.tool)).toEqual(steps.map(s=>s[0]));
   const saved=await f.controller.store.load(f.controller.draft.id);
   expect(saved.document.project.state).toEqual({value:2});expect(saved.document.project.source).toContain('Edited by AI');
  }finally{f.close();}
 },30000);
 it('patches a unique fragment through Agent tools with optimistic revision checks and durable source',async()=>{
  const f=await fixture();
  try {
   await f.controller.write({create:true,project});
   const edited=await f.tools.call('patchStudioProject',{oldText:'value++;',newText:'value+=3;',expectedRevision:1});
   expect(edited).toMatchObject({status:'project-source-patched',revision:2});
   expect(f.controller.draft.source).toContain('value+=3;');
   expect((await f.controller.store.load(project.id)).document.project.source).toContain('value+=3;');
   await f.controller.run();
   const called=await f.tools.call('interactScene',{interaction:{action:'custom',target:'counter',name:'increment'}});
   expect(called.verification.status).toBe('unverified');
   expect(f.controller.scene.inspect('counter').state.value).toBe(4);
  }finally{f.close();}
 },30000);
 it('rejects ambiguous, missing, identical, invalid and stale patches without modifying source',async()=>{
  const f=await fixture();
  try {
   await f.controller.write({create:true,project});
   const original=f.controller.draft.source;
   for (const [patch,code] of [
    [{oldText:'value',newText:'x',expectedRevision:1},'PROJECT_PATCH_AMBIGUOUS'],
    [{oldText:'missing',newText:'x',expectedRevision:1},'PROJECT_PATCH_NOT_FOUND'],
    [{oldText:'value++;',newText:'value++;',expectedRevision:1},'PROJECT_PATCH_UNCHANGED'],
    [{oldText:'',newText:'x',expectedRevision:1},'PROJECT_PATCH_INVALID'],
    [{oldText:'value++;',newText:'x',expectedRevision:0},'PROJECT_REVISION_CONFLICT'],
   ]) {
    await expect(f.controller.patch(patch)).rejects.toThrow(code);
    expect(f.controller.draft.source).toBe(original);
    expect(f.controller.revision).toBe(1);
   }
  }finally{f.close();}
 },30000);
 it('rejects storage failure before replacing a draft and serializes concurrent operations',async()=>{
  const f=await fixture();
  try {
   await f.controller.write({create:true,project});
   const original=f.controller.store.save;let reject;
   f.controller.store.save=()=>new Promise((_,fail)=>{reject=fail;});
   const write=f.controller.write({expectedRevision:1,source:source+'\n// pending'});
   await expect(f.controller.run()).rejects.toThrow('PROJECT_BUSY');
   await new Promise(resolve=>setTimeout(resolve,0));reject(new Error('disk full'));
   await expect(write).rejects.toThrow('disk full');
   expect(f.controller.draft.source).toBe(source);expect(f.controller.revision).toBe(1);
   f.controller.store.save=original;
  }finally{f.close();}
 });
});
