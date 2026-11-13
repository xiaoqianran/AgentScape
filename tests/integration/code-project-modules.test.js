import { describe, it, expect } from 'vitest';
import { openCodeProject, parseCodeProject } from '../../application/native-scene/CodeProject.js';
import { compileCodeProjectModules } from '../../application/native-scene/CodeProjectModules.js';

const project = {
 schema:'agentscape.code-project', schemaVersion:1, id:'multi_file', name:'多文件项目',
 entry:'src/main.js', resources:{},
 source:`import { Scene, PerspectiveCamera } from 'three';
import { initial } from './state.js';
import shader from '../shaders/pulse.glsl';
export function createProject() {
  let counter = initial;
  return {
    scene:new Scene(),camera:new PerspectiveCamera(),
    renderer:{render(){},extensions:{has:()=>false}},
    setup({scene}) { scene.registerEntity({id:'shader', read:()=>({counter,shader})});
      scene.registerAction({target:'shader', name:'increase',execute(){counter++;}}); },
    serialize(){return {counter};},restore(state){counter=state.counter;}
  };
}`,
 files:{
  'src/state.js':`import { start } from '../lib/constants.js'; export const initial=start;`,
  'lib/constants.js':'export const start=3;',
  'shaders/pulse.glsl':'void main() { gl_FragColor = vec4(1.0); }'
 }
};
describe('code project editable multi-file modules',()=>{
 it('imports relative JS and raw shaders, shares host THREE, and survives save/reopen',async()=>{
  const host=await openCodeProject({project,authorized:true,autoStart:false});
  let restored;
  try {
   const before=host.scene.inspect('shader').state;
   expect(before.counter).toBe(3);
   expect(before.shader).toContain('gl_FragColor');
   const job=host.scene.interact({action:'custom',target:'shader',name:'increase'});
   expect((await host.scene.waitJob(job.id)).status).toBe('succeeded');
   const saved=(await host.save()).value;
   expect(saved.entry).toBe('src/main.js');
   expect(Object.keys(saved.files)).toEqual(Object.keys(project.files));
   restored=await openCodeProject({project:saved,authorized:true,autoStart:false});
   expect(restored.scene.inspect('shader').state.counter).toBe(4);
  } finally {host.close(); restored?.close();}
 },30000);
 it('rejects missing imports and cycles before running project code',async()=>{
  await expect(compileCodeProjectModules({...project,files:{}})).rejects.toThrow('PROJECT_IMPORT_NOT_FOUND');
  const cycle={...project,source:"import './back.js'; export function createProject() {}",
    entry:'main.js',files:{'back.js':"import './main.js';"}};
  await expect(compileCodeProjectModules(cycle)).rejects.toThrow('PROJECT_IMPORT_CYCLE');
 });
 it('rejects external/dynamic imports and unsafe file paths',async()=>{
  await expect(compileCodeProjectModules({...project,source:"import fake from 'other-package'; export function createProject() {}"}))
   .rejects.toThrow('PROJECT_IMPORT_UNSUPPORTED');
  await expect(compileCodeProjectModules({...project,source:"export async function createProject() { return import('./state.js') }"}))
   .rejects.toThrow('PROJECT_DYNAMIC_IMPORT_UNSUPPORTED');
  await expect(parseCodeProject({...project,files:{'../escape.js':'export const escape=true;'}}))
   .rejects.toThrow('PROJECT_FILE_PATH_INVALID');
 });
 it('does not alter old source-only projects',async()=>{
  const old={schema:'agentscape.code-project',schemaVersion:1,id:'legacy',name:'旧版',resources:{},
   source:'export function createProject() { return null; }'};
  expect(await compileCodeProjectModules(await parseCodeProject(old))).toBe(old.source);
 });
});
