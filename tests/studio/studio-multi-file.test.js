import { describe, it, expect } from 'vitest';
import { openCodeProject } from '../../application/native-scene/CodeProject.js';
import { StudioCodeProjects } from '../../apps/studio/code-project/StudioCodeProjects.js';
import { AuthoringWorldStore } from '../../apps/studio/persistence/AuthoringWorldStore.js';
import { AgentTools } from '../../application/AgentTools.js';

const main = `import {initial} from './lib/counter.js';
import pixel from './shaders/pixel.glsl';
export function createProject({THREE}) {
 let count=initial;
 return {scene:new THREE.Scene(),camera:new THREE.PerspectiveCamera(),
  renderer:{render(){},extensions:{has:()=>false}},
  setup({scene}){scene.registerEntity({id:'counter',read:()=>({count,pixel})});},
  serialize(){return {count};},restore(s){count=s.count;}};
}`;
const project={schema:'agentscape.code-project',schemaVersion:1,id:'multi',name:'Multi',source:main,resources:{}};
const store=new AuthoringWorldStore({indexedDBImpl:null});
async function fixture() {
 const base=await openCodeProject({project:{...project,id:'base',source:`export function createProject({THREE}) {return {
   scene:new THREE.Scene(),camera:new THREE.PerspectiveCamera(),renderer:{render(){},extensions:{has:()=>false}}};}`},
   authorized:true,autoStart:false});
 const controller=new StudioCodeProjects({baseWorld:base.world,baseScene:base.scene,store,open:options=>openCodeProject({...options,autoStart:false})});
 return {base,controller,tools:controller.wrapTools(new AgentTools(base.world)),close(){controller.dispose();base.close();}};
}

describe('Studio multi-file source and resource operations',()=>{
 it('lets AI create files, patch one file, run, persist and reopen real imported modules',async()=>{
  const f=await fixture(); let other;
  try {
   await f.tools.call('writeStudioProject',{create:true,project});
   await f.tools.call('editStudioFile',{action:'create',path:'lib/counter.js',content:'export const initial=4;',expectedRevision:1});
   await f.tools.call('editStudioFile',{action:'create',path:'shaders/pixel.glsl',content:'vec4(1.0)',expectedRevision:2});
   expect(f.tools.definitions().map(x=>x.name)).toContain('readStudioFile');
   expect(f.tools.definitions().map(x=>x.name)).toContain('editStudioFile');
   expect((await f.tools.call('readStudioFile',{path:'lib/counter.js'})).content).toContain('initial=4');
   const metadata=await f.tools.call('readStudioProject');
   expect(metadata.project.files['lib/counter.js']).toEqual({chars:'export const initial=4;'.length});
   expect(metadata.project.resources).toEqual({});
   const page=await f.tools.call('readStudioFile',{path:'lib/counter.js',offset:0,limit:8});
   expect(page.content).toBe('export c');
   expect(page.nextOffset).toBe(8);
   expect(f.tools.executionPolicy('readStudioFile',page).mutates).toBe(false);
   await f.tools.call('patchStudioProject',{path:'lib/counter.js',oldText:'initial=4',newText:'initial=7',expectedRevision:3});
   expect(f.controller.revision).toBe(4);
   await f.tools.call('runStudioProject',{expectedRevision:4});
   expect(f.controller.scene.inspect('counter').state).toEqual({count:7,pixel:'vec4(1.0)'});
   const saved=await f.tools.call('saveStudioProject');
   expect(saved.value.files['lib/counter.js']).toContain('initial=7');
   await f.controller.close();
   other=await fixture();
   await other.controller.load(project.id);await other.controller.run();
   expect(other.controller.scene.inspect('counter').state.count).toBe(7);
  }finally{other?.close();f.close();}
 },30000);

 it('rejects stale, duplicate, missing, unsafe and entry deletion without changing draft',async()=>{
  const f=await fixture();
  try {
   await f.controller.write({create:true,project});
   await expect(f.controller.editFile({action:'create',path:'../escape.js',content:'x',expectedRevision:1}))
    .rejects.toThrow('PROJECT_FILE_PATH_INVALID');
   await expect(f.controller.editFile({action:'delete',path:'main.js',expectedRevision:1}))
    .rejects.toThrow('PROJECT_ENTRY_REQUIRED');
   await expect(f.controller.editFile({action:'write',path:'missing.js',content:'x',expectedRevision:1}))
    .rejects.toThrow('PROJECT_FILE_NOT_FOUND');
   await f.controller.editFile({action:'create',path:'src/new.js',content:'export const n=1;',expectedRevision:1});
   await expect(f.controller.editFile({action:'create',path:'src/new.js',content:'duplicate',expectedRevision:2}))
    .rejects.toThrow('PROJECT_FILE_EXISTS');
   await expect(f.controller.editFile({action:'patch',path:'src/new.js',oldText:'n=2',newText:'n=3',expectedRevision:2}))
    .rejects.toThrow('PROJECT_PATCH_NOT_FOUND');
   await expect(f.controller.editFile({action:'write',path:'src/new.js',content:'wrong',expectedRevision:1}))
    .rejects.toThrow('PROJECT_REVISION_CONFLICT');
   expect(f.controller.draft.files['src/new.js']).toContain('n=1');
   await f.controller.editFile({action:'rename',path:'src/new.js',newPath:'src/renamed.js',expectedRevision:2});
   expect(f.controller.draft.files['src/new.js']).toBeUndefined();
   expect(f.controller.draft.files['src/renamed.js']).toContain('n=1');
   await f.controller.editFile({action:'delete',path:'src/renamed.js',expectedRevision:3});
   expect(f.controller.draft.files['src/renamed.js']).toBeUndefined();
  }finally{f.close();}
 },30000);

 it('adds a portable texture resource without losing independent source files',async()=>{
  const f=await fixture();
  try {
   await f.controller.write({create:true,project});
   const bytes=btoa('hello');
   await f.tools.call('editStudioResource',{action:'add',path:'textures/demo.txt',mime:'text/plain',base64:bytes,expectedRevision:1});
   expect(f.controller.draft.resources['textures/demo.txt']).toEqual({mime:'text/plain',base64:bytes});
   expect(f.controller.read().project.resources['textures/demo.txt']).toEqual({mime:'text/plain',encodedChars:bytes.length});
   expect(f.controller.read().project.resources['textures/demo.txt']).not.toHaveProperty('base64');
   await expect(f.controller.editResource({action:'add',path:'textures/demo.txt',mime:'text/plain',base64:bytes,expectedRevision:2}))
    .rejects.toThrow('PROJECT_RESOURCE_EXISTS');
   await f.controller.editResource({action:'delete',path:'textures/demo.txt',expectedRevision:2});
   expect(f.controller.draft.resources['textures/demo.txt']).toBeUndefined();
  }finally{f.close();}
 });
});
