import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createWorldAuthoringContext } from '../../application/createWorldAuthoringContext.js';
import { AuthoringPromotionController } from '../../application/world-authoring/AuthoringPromotionController.js';
import { createAuthoringAssetProducer } from '../../application/world-authoring/AuthoringAssetProducer.js';
import { capturePromotionSource } from '../../application/world-authoring/AuthoringPromotionSource.js';
import { createAssetModule } from '../../modules/asset/AssetModule.js';
import { createArtifactModule } from '../../modules/artifact/ArtifactModule.js';
import { WorldRuntime } from '../../modules/world/runtime/WorldRuntime.js';
import { CommandHistory } from '../../modules/world/runtime/CommandHistory.js';
import { RenderingSystem } from '../../modules/world/runtime/systems/RenderingSystem.js';
import { createRapierPhysicsSystem } from '../helpers/createRapierPhysicsSystem.js';
import { createRecastNavigationSystem } from '../helpers/createRecastNavigationSystem.js';
import { AuthoringWorldController } from '../../apps/studio/authoring/AuthoringWorldController.js';
import { AuthoringWorldStore } from '../../apps/studio/persistence/AuthoringWorldStore.js';
import { createAuthoringModelResolver } from '../../application/world-authoring/AuthoringModelResolver.js';
import { registerAuthoringSkills } from '../../application/skills/packs/authoringSkills.js';
import { SkillRegistry } from '../../application/skills/SkillRegistry.js';
import { AgentTools } from '../../application/AgentTools.js';

const cleanup = [];
afterEach(() => { for (const dispose of cleanup.splice(0).reverse()) dispose(); vi.unstubAllGlobals(); });

async function fixture({ verify = null } = {}) {
  const physics = createRapierPhysicsSystem();
  await physics.init();
  cleanup.push(() => physics.dispose());
  const assets = createAssetModule({ manifestStore:null, libraryStore:null });
  const artifacts = createArtifactModule({ persistentStore:null });
  assets.configureProduction({ artifacts });
  const world = new WorldRuntime({ assetModule:assets, environmentFactory:()=>null, physicsFactory:()=>physics });
  const ground = new THREE.Mesh(new THREE.BoxGeometry(30, .1, 30), new THREE.MeshStandardMaterial());
  ground.position.y = -.05;
  world.environment = { id:'promotion-test', root:ground, colliders:[] };
  world.rendering = new RenderingSystem({ container:{}, scene:world.scene });
  world.navigation = createRecastNavigationSystem({ store:world.store, physics, environmentRoots:[ground] });
  cleanup.push(() => world.navigation.dispose());
  world.locomotion = { cancel:vi.fn(), cancelAll:vi.fn() };
  world.interactions = { cancelPending:vi.fn(), beforeRemove:vi.fn(), rebuildHeldOwnership:vi.fn() };
  world.sceneGraph = { batch:async fn=>fn(), changed:vi.fn(), update:vi.fn(), list:()=>[], removeObject:vi.fn() };
  world.history = new CommandHistory({ apply:scene=>world.restore(scene), events:world.events });
  const authoring = createWorldAuthoringContext(world);
  cleanup.push(() => authoring.dispose());
  const producer = createAuthoringAssetProducer({ assets, artifacts });
  const promotion = new AuthoringPromotionController({ authoring, world, produceAsset:producer, verify });
  cleanup.push(() => promotion.dispose());
  const skills = new SkillRegistry({ policy:world.policy, trace:world.trace, runtime:world });
  registerAuthoringSkills((name, options, handler)=>skills.register({name, ...options, handler}), promotion);
  world.skills = skills;
  const tools = new AgentTools(world, { actor:'human' });
  return { world, authoring, promotion, assets, artifacts, tools };
}

function addAsset(authoring, assetId = 'cup', id = 'draft') {
  const parent = new THREE.Group();
  parent.name = 'parent';
  parent.position.set(3, 1, 2);
  parent.rotation.y = Math.PI / 2;
  authoring.scene.add(parent);
  const object = new THREE.Group();
  object.name = id;
  object.userData.authoringId = id;
  object.position.set(1, 0, 0);
  authoring.modelRef(object, { assetRef:{ assetId } });
  parent.add(object);
  return object;
}

describe('Authoring promotion into a real World', () => {
  it('preserves inherited placement, creates real physics/nav, keeps original document and prevents duplicate promotion', async () => {
    const { world, authoring, promotion, tools } = await fixture();
    const object = addAsset(authoring);
    const document = authoring.export();
    const result = await tools.call('promoteAuthoringNode', { nodeId:'draft', usage:'movable' });
    expect(result.status).toBe('authoring-promoted');
    expect(world.store.get(result.entityId).object.position.toArray()).toEqual([3, 1, 1]);
    expect(world.physics.getPosition(result.entityId)).toEqual([3, 1, 1]);
    expect(result.verification.navigation.success).toBe(true);
    expect(object.visible).toBe(false);
    expect(authoring.export()).toEqual(document);
    expect(world.history.status().undo).toBe(1);
    expect((await promotion.promote('draft')).reused).toBe(true);
    expect(world.store.list()).toHaveLength(1);
    expect(world.snapshot().objects[0].state.authoringPromotion.nodeId).toBe('draft');
  });

  it('rejects nonuniform transforms, usage mismatch, missing references, overlap and nested promotions', async () => {
    const { authoring, promotion } = await fixture();
    const object = addAsset(authoring);
    object.scale.set(1, 2, 1);
    await expect(promotion.promote('draft', {usage:'movable'})).rejects.toMatchObject({code:'OBJECT_SCALE_NON_UNIFORM_UNSUPPORTED'});
    object.scale.setScalar(1);
    await expect(promotion.promote('draft', {usage:'static'})).rejects.toMatchObject({code:'AUTHORING_USAGE_MISMATCH'});
    await promotion.promote('draft', {usage:'movable'});
    const second = addAsset(authoring, 'cup', 'second');
    await expect(promotion.promote('second', {usage:'movable'})).rejects.toMatchObject({code:'AUTHORING_PLACEMENT_BLOCKED'});
    expect(second.visible).toBe(true);
    const parentId = object.parent.userData.authoringId;
    await expect(promotion.prepare(parentId)).rejects.toMatchObject({code:'AUTHORING_PROMOTION_OVERLAP'});
  });

  it('requires explicit update, preserves entity ID, and reconciles World undo/redo independently of authoring undo', async () => {
    const { world, authoring, promotion } = await fixture();
    addAsset(authoring);
    authoring.commit('before');
    const first = await promotion.promote('draft', {usage:'movable'});
    authoring.get('draft').position.x = 2;
    authoring.commit('move');
    expect(promotion.list().find(n=>n.nodeId==='draft').status).toBe('outdated');
    await expect(promotion.promote('draft')).rejects.toMatchObject({code:'AUTHORING_UPDATE_REQUIRED'});
    const updated = await promotion.promote('draft', {update:true});
    expect(updated.entityId).toBe(first.entityId);
    expect(world.store.list()).toHaveLength(1);
    expect(world.physics.getPosition(first.entityId)).toEqual([3, 1, 0]);
    await world.history.undo();
    expect(world.physics.getPosition(first.entityId)).toEqual([3, 1, 1]);
    expect(promotion.list().find(n=>n.nodeId==='draft').status).toBe('outdated');
    expect(authoring.get('draft').visible).toBe(false);
    await world.history.redo();
    expect(promotion.list().find(n=>n.nodeId==='draft').status).toBe('promoted');
    await authoring.undoAsync({resolveModel:async()=>new THREE.Group()});
    expect(world.physics.getPosition(first.entityId)).toEqual([3, 1, 0]);
    expect(promotion.list().find(n=>n.nodeId==='draft').status).toBe('outdated');
  });

  it('invalidates stale verification when the linked Runtime entity moves without changing promotion identity', async () => {
    const { world, authoring, promotion } = await fixture();
    addAsset(authoring);
    const promoted = await promotion.promote('draft', {usage:'movable'});
    expect(promotion.entries.get('draft').verification).toBeTruthy();

    await world.mutate('test:move-promoted', async () => {
      world.commands.transform(promoted.entityId, {position:[7, 1, 2]});
    });

    expect(promotion.entries.get('draft').linkId).toBe(promoted.linkId);
    expect(promotion.entries.get('draft').verification).toBeNull();
    expect(promotion.list().find(n=>n.nodeId==='draft').verification).toBeNull();
  });

  it('rolls back a failed verification and a failed replacement without hiding the draft or losing the old entity', async () => {
    let fail = true;
    const { world, authoring, promotion } = await fixture({ verify:async()=>({ok:!fail, reason:'test failure'}) });
    addAsset(authoring);
    await expect(promotion.promote('draft', {usage:'movable'})).rejects.toMatchObject({code:'AUTHORING_VERIFICATION_FAILED'});
    expect(world.store.list()).toHaveLength(0);
    expect(authoring.get('draft').visible).toBe(true);
    expect(promotion.entries.size).toBe(0);
    fail = false;
    const first = await promotion.promote('draft', {usage:'movable'});
    const previous = world.snapshot();
    authoring.get('draft').position.x = 2;
    fail = true;
    await expect(promotion.promote('draft', {update:true})).rejects.toMatchObject({code:'AUTHORING_VERIFICATION_FAILED'});
    expect(world.snapshot()).toEqual(previous);
    expect(promotion.entries.get('draft').linkId).toBe(first.linkId);
    expect(authoring.get('draft').visible).toBe(false);
  });

  it('persists linkage and runtime pose, restores missing entities, refuses identity collisions and wrong worlds', async () => {
    const { world, authoring, promotion, assets } = await fixture();
    addAsset(authoring);
    const result = await promotion.promote('draft', {usage:'movable'});
    world.commands.transform(result.entityId, {position:[8, 1, 3]});
    const controller = new AuthoringWorldController({ authoring, promotion,
      store:new AuthoringWorldStore({indexedDBImpl:null}), resolveModel:createAuthoringModelResolver({assetLoader:assets.loader}) });
    const saved = await controller.save();
    expect(controller.isDirty()).toBe(false);
    expect(saved.promotions.entries[0].instance.position).toEqual([8, 1, 3]);
    await world.commands.remove(result.entityId);
    expect(authoring.get('draft').visible).toBe(true);
    await controller.newWorld();
    await controller.openWorld(saved.id);
    expect((await promotion.restore()).status).toBe('authoring-restored');
    expect(promotion.entries.get('draft').verification).toBeTruthy();
    expect(world.physics.getPosition(result.entityId)).toEqual([8, 1, 3]);
    expect(authoring.get('draft').visible).toBe(false);
    expect((await promotion.restore()).results).toEqual([]);
    await world.commands.remove(result.entityId);
    await world.commands.spawn('cup', {id:result.entityId, position:[10, 1, 0]});
    expect((await promotion.restore()).results[0].code).toBe('AUTHORING_ENTITY_CONFLICT');
    expect(world.physics.getPosition(result.entityId)).toEqual([10, 1, 0]);
    world.environment.id = 'another-world';
    expect((await promotion.restore()).status).toBe('authoring-restore-failed');
    expect(authoring.get('draft').visible).toBe(true);
  });

  it('keeps concurrent source changes and duplicate requests from committing prepared results', async () => {
    const { authoring, promotion, assets } = await fixture();
    const object = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial());
    object.userData.authoringId = 'mesh';
    authoring.scene.add(object);
    let release;
    promotion.produceAsset = async () => { await new Promise(resolve=>{release=resolve;}); return {assetId:'chair'}; };
    const work = promotion.prepare('mesh');
    await expect(promotion.prepare('mesh')).rejects.toMatchObject({code:'AUTHORING_PROMOTION_BUSY'});
    object.position.x = 1;
    release();
    await expect(work).rejects.toMatchObject({code:'AUTHORING_PROMOTION_STALE'});
    expect(promotion.entries.size).toBe(0);
    expect(assets.hasAsset('chair')).toBe(true);
  });

  it('keeps behavior verification and asset admission separate', async () => {
    const { authoring, promotion } = await fixture();
    addAsset(authoring);
    await promotion.promote('draft', {usage:'movable'});
    expect((await promotion.verifyEntity('draft')).status).toBe('authoring-unverified');
    promotion.verifyBehavior = async()=>({status:'verified', evidence:'test behavior'});
    const verified = await promotion.verifyEntity('draft', {exerciseInteraction:true});
    expect(verified.status).toBe('authoring-verified');
    promotion.verifyBehavior = async()=>({status:'failed', reason:'blocked'});
    expect((await promotion.verifyEntity('draft', {exerciseInteraction:true})).status).toBe('authoring-unverified');
    expect(promotion.entries.get('draft').admission.status).toBe('ready');
  });

  it('keeps explicit visibility edits while presentation is suppressed and restores them on detach', async () => {
    const { world, authoring, promotion } = await fixture();
    const object = addAsset(authoring);
    const result = await promotion.promote('draft', {usage:'movable'});
    object.visible = false;
    const state = authoring.capture();
    expect(state.nodesById.draft.visible).toBe(false);
    object.visible = true;
    expect(authoring.capture().nodesById.draft.visible).toBeUndefined();
    expect(object.visible).toBe(false);
    await promotion.detach('draft');
    expect(object.visible).toBe(true);
    expect(world.store.has(result.entityId)).toBe(true);
  });

  it('rejects corrupt stored poses and prevents promotion during asynchronous document opening', async () => {
    const { authoring, promotion } = await fixture();
    addAsset(authoring);
    await promotion.promote('draft', {usage:'movable'});
    const state = promotion.exportState();
    state.entries[0].instance.scale = -1;
    expect(()=>promotion.loadState(state)).toThrow();
    expect(promotion.entries.size).toBe(1);
    let release;
    const controller = new AuthoringWorldController({authoring, promotion,
      store:{save:vi.fn(),list:vi.fn(),load:()=>new Promise(resolve=>{release=resolve;})}});
    const open = controller.openWorld('missing');
    await expect(promotion.promote('draft')).rejects.toMatchObject({code:'AUTHORING_PROMOTION_BUSY'});
    release(null);
    await expect(open).rejects.toThrow('not found');
    expect(promotion.fileBusy).toBe(false);
    expect((await promotion.promote('draft')).reused).toBe(true);
  });

  it('checks collider translation and rotation in the selected world frame', async () => {
    const { world } = await fixture();
    const blocker = {physics:{body:'fixed',colliders:[{shape:'box', halfExtents:[.2,.2,.2]}]}};
    const obstacle = new THREE.Group();
    obstacle.position.set(0, 1, -2);
    world.physics.addObject('blocker', blocker, obstacle);
    const candidate = {physics:{body:'fixed',colliders:[{shape:'box',halfExtents:[.3,.3,.3],translation:[2,0,0]}]}};
    expect(world.physics.checkManifestPose(candidate, [0,1,0]).clear).toBe(true);
    const rotated = world.physics.checkManifestPose(candidate, [0,1,0], {quaternion:new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0), Math.PI/2).toArray()});
    expect(rotated.clear).toBe(false);
    world.physics.removeObject('blocker');
  });
});

// GLTFExporter uses browser FileReader, with real Blob bytes in this headless test.
function fileReader() {
  vi.stubGlobal('FileReader', class {
    readAsArrayBuffer(blob) { blob.arrayBuffer().then(result=>{ this.result=result; this.onloadend?.(); }); }
    readAsDataURL(blob) { blob.arrayBuffer().then(result=>{ this.result=`data:${blob.type};base64,${Buffer.from(result).toString('base64')}`; this.onloadend?.(); }); }
  });
  vi.stubGlobal('ProgressEvent', class {});
}

describe('Authored geometry → verified Artifact → Asset → World', () => {
  it('compiles real mesh bytes preserving origin and materials, persists a provisional asset and explicitly promotes to editing state', async () => {
    fileReader();
    const { world, authoring, promotion, assets, artifacts } = await fixture();
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 2, 1), new THREE.MeshStandardMaterial({color:0xff0000}));
    mesh.userData.authoringId = 'box';
    mesh.position.set(4, 2, 3);
    authoring.scene.add(mesh);
    const source = capturePromotionSource(authoring, 'box');
    const prepared = await promotion.prepare('box', {usage:'movable'});
    expect(prepared.admission.status).toBe('provisional');
    expect(artifacts.registry.list()[0].integrity.state).toBe('verified');
    const manifest = assets.getManifest(prepared.assetId);
    expect(manifest.compiler.normalization).toMatchObject({preservedOrigin:true, applied:[]});
    expect(manifest.physics.body).toBe('dynamic');
    expect(manifest.physics.colliders[0].translation[1]).toBeCloseTo(0);
    await expect(promotion.promote('box')).rejects.toMatchObject({code:'AUTHORING_ASSET_PROVISIONAL'});
    expect(world.store.list()).toHaveLength(0);
    const promoted = await promotion.promote('box', {allowProvisional:true});
    expect(promoted.status).toBe('authoring-provisional');
    const instance = world.store.get(promoted.entityId).object;
    const bounds = new THREE.Box3().setFromObject(instance);
    expect(bounds.min.toArray()).toEqual([3.5, 1, 2.5]);
    expect(bounds.max.toArray()).toEqual([4.5, 3, 3.5]);
    expect(capturePromotionSource(authoring, 'box').sourceHash).toBe(source.sourceHash);
    expect(world.physics.getPosition(promoted.entityId)).toEqual([4, 2, 3]);
  });

  it('exports a Group including colored instances and reuses its asset after a placement-only edit', async () => {
    fileReader();
    const { world, authoring, promotion } = await fixture();
    const group = new THREE.Group();
    group.userData.authoringId = 'group';
    group.position.set(2, 2, 3);
    const instances = new THREE.InstancedMesh(new THREE.BoxGeometry(.5,.5,.5), new THREE.MeshStandardMaterial({color:0xffffff}), 2);
    instances.setMatrixAt(0, new THREE.Matrix4().makeTranslation(-1,0,0));
    instances.setMatrixAt(1, new THREE.Matrix4().makeTranslation(1,0,0));
    instances.setColorAt(0, new THREE.Color(0xff0000));
    instances.setColorAt(1, new THREE.Color(0x0000ff));
    group.add(instances);
    authoring.scene.add(group);
    const first = await promotion.prepare('group');
    group.position.x = 4;
    const second = await promotion.prepare('group');
    expect(second.assetId).toBe(first.assetId);
    expect(second.sourceHash).not.toBe(first.sourceHash);
    await promotion.promote('group', {allowProvisional:true});
    const object = world.store.list()[0][1].object;
    expect(new THREE.Box3().setFromObject(object).min.x).toBeCloseTo(2.75);
    const colors = [];
    object.traverse(node=>{if(node.isMesh) colors.push(node.material.color.getHexString());});
    expect(colors.sort()).toEqual(['0000ff','ff0000']);
  });

  it('routes a resolved URL ModelRef through verified production instead of registering its visual wrapper', async () => {
    fileReader();
    const { world, authoring, promotion, artifacts } = await fixture();
    const wrapper = new THREE.Group();
    wrapper.position.set(-2, 2, -3);
    wrapper.userData.authoringId = 'url-model';
    wrapper.add(new THREE.Mesh(new THREE.BoxGeometry(1,1,1), new THREE.MeshStandardMaterial()));
    authoring.modelRef(wrapper, {source:{type:'url',uri:'/models/example.glb'}});
    authoring.scene.add(wrapper);
    const result = await promotion.promote('url-model', {allowProvisional:true});
    expect(result.status).toBe('authoring-provisional');
    expect(world.store.get(result.entityId).assetId).toMatch(/^authored_/);
    expect(artifacts.registry.list()[0].integrity.state).toBe('verified');
    expect(authoring.capture().nodesById['url-model'].components.modelRef.properties.source.type).toBe('url');
  });
});
