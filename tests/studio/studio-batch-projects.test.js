import { describe, it, expect } from 'vitest';
import { openCodeProject } from '../../application/native-scene/CodeProject.js';
import { StudioCodeProjects } from '../../apps/studio/code-project/StudioCodeProjects.js';
import { AuthoringWorldStore } from '../../apps/studio/persistence/AuthoringWorldStore.js';
import { AgentTools } from '../../application/AgentTools.js';
import { ToolCallingAgent } from '../../modules/agent/ToolCallingAgent.js';

const source = `export function createProject({THREE,state}) {
 let value = state?.value ?? 1;
 return {scene:new THREE.Scene(),camera:new THREE.PerspectiveCamera(),
  renderer:{render(){},extensions:{has:()=>false}},
  setup({scene}){
   scene.registerEntity({id:'counter',read:()=>({value})});
   scene.registerAction({target:'counter',name:'increment',execute(){value++;}});
  },
  serialize(){return {value};},restore(state){value=state.value;}
 };
}`;
const project = {schema:'agentscape.code-project',schemaVersion:1,id:'batch_counter',
  name:'Batch Counter',source,resources:{}};
async function fixture() {
 const store = new AuthoringWorldStore({indexedDBImpl:null});
 const base=await openCodeProject({project:{...project,id:'base'},authorized:true,autoStart:false});
 const controller=new StudioCodeProjects({baseWorld:base.world,baseScene:base.scene,store,
  open:args=>openCodeProject({...args,autoStart:false})});
 const tools=controller.wrapTools(new AgentTools(base.world));
 return {base,store,controller,tools,close(){controller.dispose();base.close();}};
}
const changes = [
 {kind:'file',action:'patch',path:'main.js',
  oldText:'export function createProject',newText:`import { step } from './lib/step.js';
import shader from './shaders/pulse.glsl';
export function createProject`},
 {kind:'file',action:'create',path:'lib/step.js',content:'export const step = 3;'},
 {kind:'file',action:'create',path:'shaders/pulse.glsl',content:'void main() {}'},
 {kind:'file',action:'patch',path:'main.js',oldText:'value++;',newText:'value+=step;'},
 {kind:'file',action:'patch',path:'main.js',oldText:'read:()=>({value})',newText:'read:()=>({value,shader})'}
];

describe('Studio coordinated multi-file batch review',()=>{
 it('previews without persistence, applies one revision, runs dynamic action, and undoes the whole batch',async()=>{
  const f=await fixture();
  try {
   await f.controller.write({create:true,project});
   const preview=await f.tools.call('previewStudioProjectBatch',{operations:changes,expectedRevision:1});
   expect(preview).toMatchObject({status:'project-batch-preview',baseRevision:1,files:3,resources:0});
   expect(preview.changes.map(x=>x.path)).toEqual(['lib/step.js','main.js','shaders/pulse.glsl']);
   expect(preview.changes[1].diff).toContain('+ import');
   expect(f.controller.revision).toBe(1);
   expect(f.controller.draft.files).toBeUndefined();
   expect((await f.store.load(project.id)).document.revision).toBe(1);
   const applied=await f.tools.call('applyStudioProjectBatch',{previewId:preview.previewId,expectedRevision:1});
   expect(applied).toMatchObject({status:'project-batch-applied',revision:2,files:3});
   expect((await f.store.load(project.id)).document.revision).toBe(2);
   expect(f.controller.snapshot().batchPreview).toBeNull();
   expect(f.controller.snapshot().undoBatch).toMatchObject({revision:2,files:3});
   await f.controller.run();
   expect(f.controller.scene.inspect('counter').state).toEqual({value:1,shader:'void main() {}'});
   const job=f.controller.scene.interact({action:'custom',target:'counter',name:'increment'});
   expect((await f.controller.scene.waitJob(job.id)).status).toBe('succeeded');
   expect(f.controller.scene.inspect('counter').state.value).toBe(4);
   await f.controller.save();
   await f.tools.call('undoStudioProjectBatch',{expectedRevision:2});
   expect(f.controller.revision).toBe(3);
   expect(f.controller.draft.entry).toBeUndefined();
   expect(f.controller.draft.files).toBeUndefined();
   expect(f.controller.draft.state.value).toBe(4);
   expect(f.controller.snapshot().undoBatch).toBeNull();
   await f.controller.run();
   expect(f.controller.scene.inspect('counter').state.value).toBe(4);
  }finally{f.close();}
 },30000);

 it('rejects one failing operation and invalid import graph without publishing any intermediate files',async()=>{
  const f=await fixture();
  try {
   await f.controller.write({create:true,project});
   for(const operations of [
    [{kind:'file',action:'create',path:'valid.js',content:'export const ok=true;'},
     {kind:'file',action:'patch',path:'main.js',oldText:'nonexistent',newText:'x'}],
    [{kind:'file',action:'patch',path:'main.js',oldText:'export function createProject',
      newText:"import './missing.js'; export function createProject"}],
    [{kind:'file',action:'create',path:'../escape.js',content:'oops'}]
   ]) {
    await expect(f.controller.previewBatch({operations,expectedRevision:1})).rejects.toThrow();
    expect(f.controller.snapshot().batchPreview).toBeNull();
    expect(f.controller.revision).toBe(1);
    expect(f.controller.draft.files).toBeUndefined();
    expect((await f.store.load(project.id)).document.revision).toBe(1);
   }
  }finally{f.close();}
 },30000);

 it('keeps preview and old draft when persistence fails; supports retry and discard',async()=>{
  const f=await fixture();
  try {
   await f.controller.write({create:true,project});
   const preview=await f.controller.previewBatch({operations:changes,expectedRevision:1});
   const previousSave=f.store.save;
   f.store.save=async()=>{throw new Error('disk full');};
   await expect(f.controller.applyBatch({previewId:preview.previewId,expectedRevision:1}))
    .rejects.toThrow('disk full');
   expect(f.controller.revision).toBe(1);
   expect(f.controller.draft.source).toBe(source);
   expect(f.controller.snapshot().batchPreview.previewId).toBe(preview.previewId);
   f.store.save=previousSave;
   await f.controller.discardBatch({previewId:preview.previewId});
   expect(f.controller.snapshot().batchPreview).toBeNull();
   await expect(f.controller.applyBatch({previewId:preview.previewId,expectedRevision:1}))
    .rejects.toThrow('PROJECT_BATCH_PREVIEW_NOT_FOUND');
   const next=await f.controller.previewBatch({operations:changes,expectedRevision:1});
   await f.controller.applyBatch({previewId:next.previewId,expectedRevision:1});
   expect(f.controller.revision).toBe(2);
  }finally{f.close();}
 },30000);

 it('rejects stale previews and ensures one-step undo cannot overwrite later edits',async()=>{
  const f=await fixture();
  try {
   await f.controller.write({create:true,project});
   const preview=await f.controller.previewBatch({operations:changes,expectedRevision:1});
   await expect(f.controller.applyBatch({previewId:preview.previewId,expectedRevision:0}))
    .rejects.toThrow('PROJECT_REVISION_CONFLICT');
   await f.controller.editFile({action:'create',path:'extra.js',content:'export const x=1;',expectedRevision:1});
   await expect(f.controller.applyBatch({previewId:preview.previewId,expectedRevision:1}))
    .rejects.toThrow('PROJECT_BATCH_PREVIEW_NOT_FOUND');
   await expect(f.controller.undoBatch({expectedRevision:2})).rejects.toThrow('PROJECT_BATCH_UNDO_UNAVAILABLE');
   const preview2=await f.controller.previewBatch({operations:[{kind:'file',action:'patch',path:'main.js',
    oldText:'value++;',newText:'value+=2;'}],expectedRevision:2});
   await f.controller.applyBatch({previewId:preview2.previewId,expectedRevision:2});
   await f.controller.editFile({action:'write',path:'extra.js',content:'export const x=2;',expectedRevision:3});
   await expect(f.controller.undoBatch({expectedRevision:4})).rejects.toThrow('PROJECT_BATCH_UNDO_UNAVAILABLE');
  }finally{f.close();}
 },30000);

 it('runs an actual Agent tool-call loop to preview, apply, run and persist one coordinated batch',async()=>{
  const f=await fixture();let index=0;
  const plan=[
   ['readStudioProject',{}],
   ['writeStudioProject',{create:true,source,name:'Agent batch world'}],
   ['previewStudioProjectBatch',{operations:changes,expectedRevision:1}],
   ['applyStudioProjectBatch',()=>({previewId:f.controller.snapshot().batchPreview.previewId,expectedRevision:1})],
   ['runStudioProject',{expectedRevision:2}],
   ['saveStudioProject',{}]
  ];
  try {
   const agent=new ToolCallingAgent({tools:f.tools,maxSteps:10,gateway:{
    isConfigured:()=>true,
    complete:async request=>{
     expect(request.tools.map(tool=>tool.name)).toContain('previewStudioProjectBatch');
     const step=plan[index++];
     if (!step) return {message:'批量代码修改已保存。',toolCalls:[]};
     return {toolCalls:[{id:'batch-tool-'+index,name:step[0],
       args:typeof step[1]==='function'?step[1]():step[1]}]};
    }
   }});
   const result=await agent.run('同时修改主模块与两个辅助文件，然后运行并保存代码世界');
   expect(result.taskStatus).toBe('completed');
   expect(result.execution.filter(item=>item.executed).map(item=>item.tool)).toEqual(plan.map(item=>item[0]));
   expect(f.controller.draft.files['lib/step.js']).toContain('step = 3');
   expect(f.controller.runningRevision).toBe(2);
   expect((await f.store.load(f.controller.draft.id)).document.revision).toBe(2);
  }finally{f.close();}
 },30000);

 it('commits multi-file imports as one transaction, rejecting duplicate paths without partial publication',async()=>{
  const f=await fixture();
  try {
   await f.controller.write({create:true,project});
   await expect(f.controller.commitBatch({operations:[
    {kind:'file',action:'create',path:'extra/first.js',content:'export const first=1;'},
    {kind:'file',action:'create',path:'extra/first.js',content:'export const first=2;'}
   ],expectedRevision:1})).rejects.toThrow('PROJECT_FILE_EXISTS');
   expect(f.controller.revision).toBe(1);
   expect(f.controller.draft.files).toBeUndefined();
   const result=await f.controller.commitBatch({operations:[
    {kind:'file',action:'create',path:'extra/first.js',content:'export const first=1;'},
    {kind:'file',action:'create',path:'extra/second.js',content:'export const second=2;'}
   ],expectedRevision:1});
   expect(result).toMatchObject({status:'project-batch-applied',revision:2,files:2});
   expect(Object.keys(f.controller.draft.files)).toEqual(['extra/first.js','extra/second.js']);
   expect((await f.store.load(project.id)).document.revision).toBe(2);
   await f.controller.undoBatch({expectedRevision:2});
   expect(f.controller.draft.files).toBeUndefined();
  }finally{f.close();}
 },30000);

 it('never includes binary base64 in diff responses, and preserves batch resource changes through undo',async()=>{
  const f=await fixture();
  try {
   await f.controller.write({create:true,project});
   const base64=btoa('RESOURCE_SECRET_NOT_FOR_MODEL');
   const preview=await f.controller.previewBatch({operations:[
    {kind:'resource',action:'add',path:'textures/data.bin',mime:'application/octet-stream',base64}
   ],expectedRevision:1});
   expect(preview).toMatchObject({files:0,resources:1});
   expect(JSON.stringify(preview)).not.toContain(base64);
   expect(JSON.stringify(f.controller.read())).not.toContain(base64);
   await f.controller.applyBatch({previewId:preview.previewId,expectedRevision:1});
   expect(f.controller.draft.resources['textures/data.bin'].base64).toBe(base64);
   await f.controller.undoBatch({expectedRevision:2});
   expect(f.controller.draft.resources['textures/data.bin']).toBeUndefined();
  }finally{f.close();}
 },30000);
});
