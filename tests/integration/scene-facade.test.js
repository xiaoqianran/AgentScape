import { describe, it, expect } from 'vitest';
import { openScene, createSceneFacade } from '../../application/scene/SceneFacade.js';
import { createSession } from '../../application/createSession.js';
import { createMonumentHall } from '../../modules/world/content/monumentHall.js';
import { createBlankWorld } from '../../modules/world/content/blankWorld.js';
import * as THREE from 'three';

const project = { schema: 'agentscape.scene-project', schemaVersion: 1, name: 'Contract', environment: { type: 'builtin', id: 'monument-hall' }, objects: [] };
async function finish(scene, job) {
  for (let tick = 0; scene.getJob(job.id).status === 'running' && tick < 12000; tick++) {
    scene.step();
    if (tick % 12 === 0) await new Promise(resolve => setTimeout(resolve, 0)); else await Promise.resolve();
  }
  expect(scene.getJob(job.id).status).not.toBe('running');
  return scene.waitJob(job.id);
}
describe('single Scene application service', () => {
  it('discovers native environment interactions and distinguishes activation from verified physics', async () => {
    const session=createSession(null,{environmentFactory:createBlankWorld});
    await session.world.init();
    const {world,scene}=session;
    try {
      await scene.addModel({id:'agent',asset:'builtin://agent',level:'physical',position:[0,0,0]});
      const mesh=new THREE.Mesh(new THREE.BoxGeometry(.2,.2,.2),new THREE.MeshBasicMaterial());
      mesh.position.set(0,1,0.5);
      world.environment.root.add(mesh);
      let activated=0;
      world.environment.interactions=[{id:'switch_1',label:'Demo switch',object:mesh,activate:()=>{activated++;}}];

      const observed=scene.observe({actor:'agent'}).nativeInteractions;
      expect(observed.count).toBe(1);
      expect(observed.items[0]).toMatchObject({
        id:'switch_1',verification:'native-provisional',executeVia:'activateEnvironmentInteract'
      });
      const job=scene.interact({action:'activate',actor:'agent',target:'switch_1'});
      const outcome=await scene.waitJob(job.id);
      expect(outcome).toMatchObject({
        status:'succeeded',
        result:{verification:{status:'unverified'},value:{provisional:true,physicsVerified:false}}
      });
      expect(activated).toBe(1);
      mesh.position.set(9,1,0);
      const blocked=await scene.waitJob(scene.interact({action:'activate',actor:'agent',target:'switch_1'}).id);
      expect(blocked).toMatchObject({status:'failed',result:{value:{reason:'OUT_OF_REACH'}}});
      expect(activated).toBe(1);
      expect(()=>scene.interact({action:'activate',actor:'agent',target:'missing'})).toThrow('INTERACTION_UNAVAILABLE');
      expect(()=>scene.interact({action:'activate',actor:'fake',target:'switch_1'})).toThrow('ACTOR_NOT_AGENT');
    } finally {scene.close();world.dispose();}
  });
  it.each(['industrial-cabinet-lab','suzhou-garden'])('uses catalog environment %s without silently opening Monument Hall', async id => {
    const scene=await openScene({project:{...project,environment:{type:'builtin',id}}});
    try {
      expect(scene.snapshot().metadata.environment).toBe(id);
      expect((await scene.save()).value.project.environment.id).toBe(id);
    } finally {scene.close();}
  },30000);
  it('explicitly refuses headless browser-only and unknown environments', async () => {
    await expect(openScene({project:{...project,environment:{type:'builtin',id:'magic-cabin'}}}))
      .rejects.toMatchObject({code:'ENVIRONMENT_REQUIRES_BROWSER'});
    await expect(openScene({project:{...project,environment:{type:'builtin',id:'does-not-exist'}}}))
      .rejects.toMatchObject({code:'INVALID_DOCUMENT'});
    for(const removedId of ['blank-world','house-world','house-door-world']){
      await expect(openScene({project:{...project,environment:{type:'builtin',id:removedId}}}))
        .rejects.toMatchObject({code:'INVALID_DOCUMENT'});
    }
  });
  it('keeps the scene locked while a recipe is being compiled and admitted', async () => {
    const session = createSession(null, { environmentFactory: () => createMonumentHall({ loadAssets: false }) });
    await session.world.init();
    const assets = session.world.assetModule;
    const original = assets.importRecipe.bind(assets);
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    assets.importRecipe = async recipe => { await gate; return original(recipe); };
    const pending = session.scene.addModel({ id:'box', asset:{ schema:'agentscape.asset-recipe', schemaVersion:1,
      id:'example/locked', parts:[{ id:'body', geometry:{ type:'box', size:[1,1,1] } }] } });
    try {
      expect(() => session.scene.close()).toThrow('SCENE_BUSY');
      await expect(session.scene.save()).rejects.toMatchObject({ code:'SCENE_BUSY' });
      await expect(session.scene.addModel({ id:'cup', asset:'builtin://cup' })).rejects.toMatchObject({ code:'SCENE_BUSY' });
      release();
      expect((await pending).status).toBe('succeeded');
      expect(session.scene.observe().objects.map(object => object.id)).toEqual(['box']);
    } finally {
      release(); await pending.catch(() => {});
      session.scene.close(); session.world.dispose();
    }
  });
  it('uses the existing Runtime store and a single service across session consumers', async () => {
    const session = createSession(null, { environmentFactory: () => createMonumentHall({ loadAssets: false }) });
    await session.world.init();
    try {
      expect(createSceneFacade(session.world)).toBe(session.scene);
      await session.scene.addModel({ id: 'cup', asset: 'builtin://cup' });
      expect(session.world.store.has('cup')).toBe(true);
      expect(session.scene.observe().objects[0].physicsRegistered).toBe(true);
      await session.world.history.undo();
      expect(session.scene.observe().objects).toHaveLength(0);
      await session.world.history.redo();
      expect(session.scene.observe().objects).toHaveLength(1);
    } finally { session.scene.close(); session.world.dispose(); }
  });
  it('enforces revision, idempotency, transform and explicit partial batch results', async () => {
    const scene = await openScene({ project });
    try {
      const request = { requestId: 'add_cup', expectedRevision: 0, operations: [{ type: 'add', model: { id: 'cup', asset: 'builtin://cup' } }] };
      const added = await scene.apply(request);
      expect(await scene.apply(request)).toEqual(added);
      expect(scene.observe().objects).toHaveLength(1);
      await expect(scene.apply({ ...request, expectedRevision: 1 })).rejects.toMatchObject({ code: 'REQUEST_CONFLICT' });
      await expect(scene.apply({ expectedRevision: 0, operations: [{ type: 'remove', id: 'cup' }] })).rejects.toMatchObject({ code: 'REVISION_CONFLICT' });
      await scene.setTransform({ id: 'cup', transform: { position: [2, 1, 3], quaternion: [0, 1, 0, 0], scale: 2 } });
      expect(scene.observe().objects[0].transform).toEqual({ position: [2, 1, 3], quaternion: [0, 1, 0, 0], scale: 2 });
      const batch = await scene.apply({ operations: [
        { type: 'add', model: { id: 'chair', asset: 'builtin://chair' } },
        { type: 'remove', id: 'missing' }, { type: 'remove', id: 'cup' }
      ] });
      expect(batch.status).toBe('failed');
      expect(batch.value.applied).toHaveLength(1);
      expect(batch.value.notRun).toEqual([2]);
      expect(scene.observe().objects.map(o => o.id)).toEqual(['cup', 'chair']);
      expect(added.verification.status).toBe('not-requested');
      expect(scene.verify([{ id: 'exists', kind: 'object-exists', targetId: 'cup' }]).verification.status).toBe('verified');
    } finally { scene.close(); }
  });
  it('preflights every asset before writing and rejects unsupported capabilities', async () => {
    const scene = await openScene({ project });
    try {
      await expect(scene.apply({ operations: [
        { type: 'add', model: { id: 'cup', asset: 'builtin://cup' } },
        { type: 'add', model: { id: 'missing', asset: 'builtin://missing' } }
      ] })).rejects.toMatchObject({ code: 'ASSET_UNAVAILABLE' });
      expect(scene.observe().objects).toHaveLength(0);
      expect((await scene.setStyle('builtin://toon')).value.status).toBe('deferred');
    } finally { scene.close(); }
  });
  it('lets Agents create declarative models without source execution', async () => {
    const session = createSession(null, { environmentFactory: () => createMonumentHall({ loadAssets: false }) });
    await session.world.init();
    try {
      const response = await session.world.skills.invoke('addSceneModel', { model: { id:'recipe', asset:{ schema:'agentscape.asset-recipe', schemaVersion:1, id:'example/agent', parts:[{id:'body',geometry:{type:'box',size:[1,1,1]}}] } } });
      expect(response.success).toBe(true);
      expect(session.scene.observe().objects[0]).toMatchObject({ id:'recipe', physicsRegistered:false });
      const denied = await session.world.skills.invoke('addSceneModel', { model:{id:'denied',asset:'builtin://cup'} }, {profile:'viewer'});
      expect(denied.success).toBe(false);
    } finally { session.scene.close(); session.world.dispose(); }
  });
  it('tracks verified physical actions and cancellation without accepting concurrent edits', async () => {
    const scene = await openScene({ project: { ...project, objects: [
      { id: 'agent', asset: 'builtin://agent', level: 'physical', transform: { position: [0, 0, 6] } },
      { id: 'cup', asset: 'builtin://cup', level: 'physical', transform: { position: [0, 0, 2] } }
    ] } });
    try {
      const job = scene.interact({ action: 'pickup', actor: 'agent', target: 'cup' });
      await expect(scene.remove({ id: 'cup' })).rejects.toMatchObject({ code: 'SCENE_BUSY' });
      const completed = await finish(scene, job);
      expect(completed.result.verification.status).toBe('verified');
      await expect(scene.remove({ id: 'cup' })).rejects.toMatchObject({ code: 'OBJECT_HELD' });
      await expect(scene.executeSkill('moveObject', { id: 'agent', position: [1, 0, 1] })).rejects.toMatchObject({ code: 'OBJECT_HELD' });
      const navigation = scene.interact({ action: 'navigate', actor: 'agent', position: [8, 0, 8] });
      scene.cancelJob(navigation.id);
      expect((await finish(scene, navigation)).status).toBe('cancelled');
      expect(scene.getJob(navigation.id).result.verification.status).not.toBe('verified');
    } finally { scene.close(); }
  }, 60000);
});
