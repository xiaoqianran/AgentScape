import {it,expect} from 'vitest';
import {readFile} from 'node:fs/promises';
import {openCodeProject,parseCodeProject} from '../../application/native-scene/CodeProject.js';
import {AgentTools} from '../../application/AgentTools.js';

const fixture=async()=>JSON.parse(await readFile('examples/code-project/semantic-workshop.json','utf8'));
const invoke=async(scene,target,name)=>{
  const job=scene.interact({action:'invoke',target,name});
  return scene.waitJob(job.id);
};

it('runs a real multi-file book and cooker as discoverable, guarded, visually verified state machines',async()=>{
  const session=await openCodeProject({project:await fixture(),authorized:true,autoStart:false});
  const {scene}=session;
  try {
    const book=scene.inspect('book_01'),cooker=scene.inspect('cooker_01');
    expect(book.state).toMatchObject({cover:'closed',page:0,pages:5});
    expect(book.capabilities.find(c=>c.name==='turnPage')).toMatchObject({action:'invoke',source:'project',available:false,verification:'project-defined'});
    expect(cooker.capabilities.find(c=>c.name==='startCook').available).toBe(false);
    expect(cooker.capabilities.some(c=>c.name==='completeCook')).toBe(false);
    expect((await invoke(scene,'book_01','turnPage')).result.diagnostics).toEqual([expect.objectContaining({code:'PROJECT_ACTION_UNAVAILABLE'})]);
    expect((await invoke(scene,'cooker_01','addRice')).status).toBe('failed');
    expect((await invoke(scene,'book_01','openBook')).result.verification.status).toBe('verified');
    expect((await invoke(scene,'book_01','turnPage')).result.verification.status).toBe('verified');
    expect(scene.inspect('book_01').state.page).toBe(1);
    const bookObject=scene.native.scene.getObjectByName('InteractiveBook');
    expect(bookObject.getObjectByName('Page_1').rotation.y).toBeCloseTo(-Math.PI,5);
    expect(bookObject.getObjectByName('Page_2').rotation.y).toBeCloseTo(0,5);
    expect(scene.verify([{id:'page',kind:'state-equals',targetId:'book_01',stateKey:'page',value:1}]).value.status).toBe('world-accepted');
    expect((await invoke(scene,'book_01','closeBook')).status).toBe('failed');

    expect((await invoke(scene,'cooker_01','openLid')).status).toBe('succeeded');
    const cookerObject=scene.native.scene.getObjectByName('InteractiveRiceCooker');
    expect(cookerObject.getObjectByName('CookerLidHinge').rotation.x).toBeCloseTo(-1.34,5);
    expect((await invoke(scene,'cooker_01','addRice')).status).toBe('succeeded');
    expect(cookerObject.getObjectByName('RicePortion').position.x).toBeCloseTo(0,5);
    expect((await invoke(scene,'cooker_01','closeLid')).status).toBe('succeeded');
    expect((await invoke(scene,'cooker_01','startCook')).result.verification.status).toBe('verified');
    expect((await invoke(scene,'cooker_01','openLid')).status).toBe('failed');
    const tools=new AgentTools(session.world);
    const observed=await tools.call('observeScene',{});
    expect(observed.project.entities.find(x=>x.id==='book_01').capabilities.some(c=>c.name==='turnBack')).toBe(true);
    expect(observed.project.entities.find(x=>x.id==='cooker_01').state.mode).toBe('cooking');
    expect((await tools.call('planSceneTask',{criteria:[{id:'finished',kind:'state-equals',targetId:'cooker_01',stateKey:'mode',value:'done'}]})).status).toBe('scene-task-plan');
  } finally {session.close();}
},30000);

it('automatically persists machine states, reopens with the actual visuals and resumes a cooking timer',async()=>{
  const session=await openCodeProject({project:await fixture(),authorized:true,autoStart:false});
  let reopened;
  try {
    await invoke(session.scene,'book_01','openBook');
    await invoke(session.scene,'book_01','turnPage');
    await invoke(session.scene,'book_01','turnPage');
    await invoke(session.scene,'cooker_01','openLid');
    await invoke(session.scene,'cooker_01','addRice');
    await invoke(session.scene,'cooker_01','closeLid');
    await invoke(session.scene,'cooker_01','startCook');
    session.frame(0);session.frame(1250);
    expect(session.scene.inspect('cooker_01').state).toMatchObject({mode:'cooking',elapsed:1.25});
    const saved=(await session.save()).value;
    expect(saved.state).toBeNull(); // No per-project serialize() is required.
    expect(saved.machines).toMatchObject({schema:'agentscape.project-machine-state',schemaVersion:1,
      entities:{book_01:{cover:'open',page:2},cooker_01:{mode:'cooking',elapsed:1.25}}});
    expect((await parseCodeProject(saved)).machines.entities.book_01.page).toBe(2);
    const corrupted=structuredClone(saved);corrupted.machines.entities.book_01.page=999;
    await expect(parseCodeProject(corrupted)).rejects.toThrow('CODE_PROJECT_INTEGRITY_MISMATCH');
    session.close();
    reopened=await openCodeProject({project:saved,authorized:true,autoStart:false});
    expect(reopened.scene.inspect('book_01').state).toMatchObject({page:2,cover:'open'});
    expect(reopened.scene.native.scene.getObjectByName('Page_2').rotation.y).toBeCloseTo(-Math.PI,5);
    expect(reopened.scene.native.scene.getObjectByName('CookerLidHinge').rotation.x).toBeCloseTo(0,5);
    expect(reopened.scene.native.scene.getObjectByName('RicePortion').position.x).toBeCloseTo(0,5);
    expect(reopened.scene.verify([{id:'page',kind:'state-equals',targetId:'book_01',stateKey:'page',value:2}]).value.status).toBe('world-accepted');
    expect(reopened.scene.verify([{id:'old-action',kind:'interaction-verified',targetId:'book_01',capability:'TURNPAGE'}]).value.status).toBe('world-incomplete');
    reopened.frame(0);reopened.frame(1750);
    expect(reopened.scene.inspect('cooker_01').state).toMatchObject({mode:'done',contents:'cooked',elapsed:3});
    expect(reopened.scene.native.scene.getObjectByName('InteractiveRiceCooker').getObjectByName('RicePortion').material.color.getHex()).toBe(0xfff3cb);
    expect((await invoke(reopened.scene,'cooker_01','openLid')).status).toBe('succeeded');
    expect((await invoke(reopened.scene,'cooker_01','serveRice')).result.verification.status).toBe('verified');
    expect(reopened.scene.inspect('cooker_01').state).toMatchObject({mode:'idle',contents:'empty',elapsed:0});
    expect(reopened.scene.native.scene.getObjectByName('RicePortion').position.x).toBeCloseTo(-.85,5);
    expect(reopened.scene.verify([{id:'served',kind:'state-equals',targetId:'cooker_01',stateKey:'contents',value:'empty'}]).value.status).toBe('world-accepted');
  } finally {session.close();reopened?.close();}
},30000);
