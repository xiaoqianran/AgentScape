import { it, expect } from 'vitest';
import { createSession } from '../../application/createSession.js';
import { AgentTools } from '../../application/AgentTools.js';
import { createMonumentHall } from '../../modules/world/content/monumentHall.js';
import { openScenePackage } from '../../application/scene/ScenePackage.js';
import { createAssetModule } from '../../modules/asset/AssetModule.js';
import { createHeadlessGLTFLoader } from '../../apps/mcp-server/HeadlessGLTFLoader.js';
import { installHeadlessAssetIO } from '../../apps/mcp-server/HeadlessAssetIO.js';

const recipe = (id, { mass=1, body='dynamic', carryable }={}) => ({
  schema:'agentscape.asset-recipe',schemaVersion:1,id:'test/' + id,
  parts:[{id:'shell',position:[0,.16,0],geometry:{type:'box',size:[.32,.32,.32]}}],
  capabilities:{level:'physical',physics:{body,mass,friction:.5,
    ...(carryable == null ? {} : {carryable}),
    colliders:[{shape:'box',halfExtents:[.16,.16,.16],translation:[0,.16,0]}]}}
});

async function setup(config = {}) {
  installHeadlessAssetIO();
  const session = createSession(null, {environmentFactory:()=>createMonumentHall({loadAssets:false})});
  await session.world.init();
  await session.scene.addModel({id:'worker',asset:'builtin://agent',position:[0,0,0]});
  await session.scene.addModel({id:'unknown_artefact',asset:recipe('unclassified',config),position:[.65,0,0]});
  for(let i=0;i<40;i++)session.scene.step();
  return session;
}

async function finish(scene,job, limit=2500) {
  for(let i=0;i<limit && scene.getJob(job.id).status==='running';i++) {
    scene.step();
    if(i%12===0)await new Promise(resolve=>setTimeout(resolve,0));
    else await Promise.resolve();
  }
  expect(scene.getJob(job.id).status).not.toBe('running');
  return scene.waitJob(job.id);
}

it('discovers and physically carries a new generic recipe with no pickup/drop/place declaration, and restores affordances',async()=>{
  const {world,scene}=await setup();
  let reopened;
  try {
    const record=world.store.get('unknown_artefact');
    expect(record.manifest.type).toBe('prop');
    expect(record.manifest.actions).not.toEqual(expect.arrayContaining(['pickup','drop','place']));
    const inspection=scene.inspect('unknown_artefact',{actor:'worker'});
    expect(inspection.actions.find(action=>action.action==='pickup')).toMatchObject({
      execution:'interaction', capabilitySource:'physical-inference', graspVerified:false
    });
    expect(inspection.capabilities.find(c=>c.name==='pickup')).toMatchObject({
      executor:'interaction',source:'asset'
    });
    const tools=new AgentTools(world,{profile:'builder',actor:'worker',source:'test'});
    const observed=await tools.call('observeScene',{actor:'worker'});
    expect(observed.affordances.entities.find(e=>e.id==='unknown_artefact').capabilities.some(c=>c.name==='pickup')).toBe(true);

    const pickup=await finish(scene,scene.interact({action:'invoke',name:'pickup',actor:'worker',target:'unknown_artefact'}));
    expect(pickup.status,JSON.stringify(pickup)).toBe('succeeded');
    expect(pickup.result.verification.status).toBe('verified');
    expect(pickup.result.value).toMatchObject({status:'held',attachment:'kinematic-anchor',graspVerified:false});
    expect(world.interactions.heldByAgent('worker')).toBe('unknown_artefact');

    await scene.addModel({id:'support',asset:'builtin://table',position:[2.5,0,-1.5]});
    const placement=await finish(scene,scene.interact({action:'invoke',name:'place',actor:'worker',target:'support'}));
    expect(placement.status,JSON.stringify(placement)).toBe('succeeded');
    expect(placement.result.value).toMatchObject({status:'placed',supportVerified:true});
    expect(world.interactions.heldByAgent('worker')).toBeNull();
    expect(scene.verify([{id:'on-surface',kind:'relation-exists',subject:'unknown_artefact',predicate:'ON',object:'support'}]).value.status).toBe('world-accepted');

    const saved=(await scene.save()).value;
    reopened=await openScenePackage(saved,{assetModule:createAssetModule({gltfLoader:createHeadlessGLTFLoader()})});
    const again=reopened.inspect('unknown_artefact',{actor:'worker'});
    expect(again.actions.some(action=>action.action==='pickup')).toBe(true);
    expect(again.capabilities.some(c=>c.name==='pickup')).toBe(true);
    expect(reopened.observe().objects.find(o=>o.id==='unknown_artefact').physicsRegistered).toBe(true);
  } finally {scene.close();world.dispose();reopened?.close();}
},90000);

it.each([
  ['opted-out',{carryable:false},'CARRY_DISABLED'],
  ['overweight',{mass:18},'CARRY_MASS_EXCEEDED'],
  ['fixed',{body:'fixed'},null]
])('never grants pickup from geometry alone when %s',async(_label,config,reason)=>{
  const {scene,world}=await setup(config);
  try {
    const inspection=scene.inspect('unknown_artefact',{actor:'worker'});
    expect(inspection.actions.some(action=>action.action==='pickup')).toBe(false);
    if(reason)expect(inspection.capabilityCandidates).toEqual([expect.objectContaining({action:'pickup',executable:false,reason})]);
    expect(world.interactions.heldByAgent('worker')).toBeNull();
    expect(() => world.interactions.assertAgentCarryable('worker','unknown_artefact')).toThrow();
  } finally {scene.close();world.dispose();}
},30000);
