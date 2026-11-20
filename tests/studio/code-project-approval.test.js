import {it,expect} from 'vitest';
import {StudioCodeProjects} from '../../apps/studio/code-project/StudioCodeProjects.js';
import {projectExecutionFingerprint} from '../../apps/studio/code-project/ProjectExecutionPolicy.js';
import {AuthoringWorldStore} from '../../apps/studio/persistence/AuthoringWorldStore.js';
import {openCodeProject} from '../../application/native-scene/CodeProject.js';
import {AgentTools} from '../../application/AgentTools.js';

const source='export function createProject({THREE}) { return {scene:new THREE.Scene(),camera:new THREE.PerspectiveCamera(),renderer:{render(){},extensions:{has:()=>false}},setup({scene}){scene.registerEntity({id:"safety_marker"});}};}';
const document={schema:'agentscape.code-project',schemaVersion:1,id:'safety_sample',source,name:'Safety',resources:{}};

it('MCP cannot authorize code; human approval is SHA-256 bound to one project revision and all bytes',async()=>{
 const base=await openCodeProject({project:{...document,id:'base'},authorized:true,autoStart:false});
 const controller=new StudioCodeProjects({baseWorld:base.world,baseScene:base.scene,
   store:new AuthoringWorldStore({indexedDBImpl:null}),
   open:args=>openCodeProject({...args,autoStart:false})});
 const tools=controller.wrapTools(new AgentTools(base.world));
 try {
  const written=await controller.write({create:true,project:document});
  expect(written.revision).toBe(1);
  await expect(controller.run()).rejects.toThrow('PROJECT_EXECUTION_REVIEW_REQUIRED');
  expect(tools.definitions().map(tool=>tool.name)).not.toContain('approveStudioProject');
  const unauthorized=await tools.call('runStudioProject',{expectedRevision:1}).catch(error=>error);
  expect(JSON.stringify(unauthorized)).toContain('PROJECT_EXECUTION_REVIEW_REQUIRED');
  expect(controller.session).toBeNull();
  const first=await controller.approveCurrentRevision();
  expect(first).toMatchObject({id:'safety_sample',revision:1});
  expect(first.digest).toMatch(/^[a-f0-9]{12}$/);
  await controller.run({expectedRevision:1});
  expect(controller.scene.inspect('safety_marker').id).toBe('safety_marker');

  // Even an in-memory edit that skips write()/revision increment cannot reuse approval.
  controller.draft.source+='\n// Changed without write()';
  await expect(controller.run({expectedRevision:1})).rejects.toThrow('PROJECT_EXECUTION_REVIEW_REQUIRED');
  controller.draft.source=source;
  const changed=await controller.write({expectedRevision:1,source:source+'\n// Revised'});
  expect(changed.revision).toBe(2);
  expect(controller.snapshot().approval).toBeNull();
  await expect(controller.run({expectedRevision:2})).rejects.toThrow('PROJECT_EXECUTION_REVIEW_REQUIRED');
  expect(await projectExecutionFingerprint(document,1)).not.toBe(
    await projectExecutionFingerprint({...document,resources:{'x.png':{mime:'image/png',base64:'AAAA'}}},1));
  await controller.approveCurrentRevision();
  await controller.run({expectedRevision:2});
  await controller.close();
  await controller.load(document.id);
  expect(controller.snapshot().approval).toBeNull();
  await expect(controller.run()).rejects.toThrow('PROJECT_EXECUTION_REVIEW_REQUIRED');
 } finally {
  controller.dispose();base.close();
 }
},30000);
