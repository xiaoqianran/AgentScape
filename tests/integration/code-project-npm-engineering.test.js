import { it, expect } from 'vitest';
import { buildCodeProject } from '../../dev/build-code-project.mjs';
import { openCodeProject, parseCodeProject } from '../../application/native-scene/CodeProject.js';
import { StudioCodeProjects } from '../../apps/studio/code-project/StudioCodeProjects.js';
import { AuthoringWorldStore } from '../../apps/studio/persistence/AuthoringWorldStore.js';
import { AgentTools } from '../../application/AgentTools.js';

const entry = 'examples/code-project/standard-three/main.js';
const build = () => buildCodeProject({entry,id:'standard_three',name:'Standard Three'});

it('bundles installed npm packages and lazy ESM chunks with one shared Three.js runtime', async () => {
  const project = await build();
  expect(project.entry).toBe('main.js');
  expect(Object.keys(project.files)).toEqual([expect.stringMatching(/^chunks\/lazy-.*\.js$/)]);
  expect(project.source).toContain('MeshBVH');
  expect(project.source).toContain('examplePulse');
  const host = await openCodeProject({project,authorized:true,autoStart:false});
  let restored;
  try {
    expect(host.scene.inspect('npm_sculpture').state).toMatchObject({turns:0,bvhReady:true});
    const action = host.scene.interact({action:'custom',target:'npm_sculpture',name:'spin'});
    expect((await host.scene.waitJob(action.id)).result.verification.status).toBe('verified');
    expect(host.scene.inspect('npm_sculpture').state.turns).toBe(1);
    const saved=(await host.save()).value;
    expect(saved.files).toEqual(project.files);
    restored=await openCodeProject({project:await parseCodeProject(saved),authorized:true,autoStart:false});
    expect(restored.scene.inspect('npm_sculpture').state.turns).toBe(1);
    const again=restored.scene.interact({action:'custom',target:'npm_sculpture',name:'spin'});
    expect((await restored.scene.waitJob(again.id)).result.verification.status).toBe('verified');
    expect(restored.scene.inspect('npm_sculpture').state.turns).toBe(2);
  } finally {host.close();restored?.close();}
},30000);

it('runs the same bundled npm project through Studio AgentTools and preserves revision/save semantics', async () => {
  const project = await build();
  const base=await openCodeProject({project:{...project,id:'base'},authorized:true,autoStart:false});
  const store=new AuthoringWorldStore({indexedDBImpl:null});
  const controller=new StudioCodeProjects({baseWorld:base.world,baseScene:base.scene,store,
    open:options=>openCodeProject({...options,autoStart:false})});
  const tools=controller.wrapTools(new AgentTools(base.world));
  try {
    const written=await tools.call('writeStudioProject',{create:true,project});
    expect(written).toMatchObject({status:'project-draft-saved',revision:1});
    const running=await tools.call('runStudioProject',{expectedRevision:1});
    expect(running.status).toBe('project-running');
    expect(controller.scene.inspect('npm_sculpture').state.bvhReady).toBe(true);
    const action=await tools.call('interactScene',{interaction:{action:'custom',target:'npm_sculpture',name:'spin'}});
    expect(action.verification.status).toBe('verified');
    expect(controller.scene.inspect('npm_sculpture').state.turns).toBe(1);
    const saved=await tools.call('saveStudioProject');
    expect(saved.value.files).toEqual(project.files);
    await tools.call('closeStudioProject');
    await tools.call('openStudioProject',{id:project.id});
    await tools.call('runStudioProject',{expectedRevision:controller.revision});
    expect(controller.scene.inspect('npm_sculpture').state.turns).toBe(1);
  } finally {controller.dispose();base.close();}
},30000);
