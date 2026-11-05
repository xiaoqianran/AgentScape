import { it, expect, vi } from 'vitest';
import { createSession } from '../../application/createSession.js';
import { createMonumentHall } from '../../modules/world/content/monumentHall.js';
import * as THREE from 'three';

const boxRecipe = (mass = 1, body = 'dynamic') => ({ schema:'agentscape.asset-recipe', schemaVersion:1,
  id:`test/crate_${String(mass).replace('.', '_')}_${body}`, parts:[{ id:'body', geometry:{type:'box',size:[.4,.4,.4]}, position:[0,.2,0] }],
  capabilities:{level:'physical',physics:{body,mass,friction:.5,colliders:[{shape:'box',halfExtents:[.2,.2,.2],translation:[0,.2,0]}]}} });

async function setup(mass = 1) {
  const session = createSession(null, { environmentFactory:() => createMonumentHall({loadAssets:false}) });
  await session.world.init();
  await session.scene.addModel({id:'actor',asset:'builtin://agent',position:[0,0,0]});
  await session.scene.addModel({id:'new_crate',asset:boxRecipe(mass),position:[.65,0,0]});
  for (let n=0;n<30;n++) session.scene.step();
  return session;
}

async function finish(scene, job, limit = 1200) {
  for (let n=0;n<limit && scene.getJob(job.id).status === 'running';n++) {
    scene.step();
    if (n%12 === 0) await new Promise(resolve => setTimeout(resolve,0)); else await Promise.resolve();
  }
  expect(scene.getJob(job.id).status).not.toBe('running');
  return scene.waitJob(job.id);
}

it.each([.5, 5])('discovers and pushes a previously unknown %s kg crate one meter using solver forces', async mass => {
  const {scene,world} = await setup(mass);
  try {
    const available = scene.inspect('new_crate',{actor:'actor'}).actions.find(action=>action.action==='push');
    expect(available).toMatchObject({available:true,parameters:{distance:{unit:'meter'}}});
    const pose = vi.spyOn(world.physics,'setPosition');
    const force = vi.spyOn(world.physics,'applyForce');
    const task = scene.interact({actor:'actor',target:'new_crate',action:'push',args:{direction:[1,0,0],distance:1}});
    const result = await finish(scene,task);
    expect(result, JSON.stringify(result)).toMatchObject({status:'succeeded',result:{verification:{status:'verified'},value:{physicsVerified:true,evidenceKind:'rigid-body-force',targetReached:true,settled:true}}});
    expect(result.result.value.progress).toBeCloseTo(1,1);
    expect(force).toHaveBeenCalled(); expect(pose).not.toHaveBeenCalled();
    expect(world.physics.getPosition('new_crate')[0]).toBeCloseTo(1.65,1);
    expect(world.physics.getMotion('new_crate').linearSpeed).toBeLessThan(.08);
  } finally {scene.close();world.dispose();}
});

it('reports a collision-blocked push as unverified and preserves actual partial motion', async () => {
  const {scene,world} = await setup();
  try {
    await scene.addModel({id:'wall',asset:boxRecipe(1,'fixed'),position:[1.5,0,0]});
    const result = await finish(scene,scene.interact({actor:'actor',target:'new_crate',action:'push',args:{direction:[1,0,0],distance:1}}));
    expect(result.status).toBe('failed');
    expect(result.result.value).toMatchObject({reason:'STALL',verified:false});
    expect(result.result.value.progress).toBeGreaterThan(.05);
    expect(world.physics.getPosition('new_crate')[0]).toBeLessThan(1.15);
  } finally {scene.close();world.dispose();}
});

it('drags a dynamic chair through its declared colliders without a chair-specific Agent skill', async () => {
  const {scene,world} = await setup();
  try {
    await scene.remove({id:'new_crate'});
    const chair = world.assetModule.getManifest('chair');
    chair.physics.body = 'dynamic'; chair.physics.mass = 3;
    await world.assetModule.registerManifest(chair,{replace:true});
    await scene.addModel({id:'movable_chair',asset:'builtin://chair',position:[-.85,0,0]});
    for(let n=0;n<60;n++) scene.step();
    const result = await finish(scene,scene.interact({actor:'actor',target:'movable_chair',action:'drag',args:{direction:[1,0,0],distance:.3}}));
    expect(result,JSON.stringify(result)).toMatchObject({status:'succeeded',result:{value:{physicsVerified:true,action:'drag'}}});
    expect(result.result.value.progress).toBeCloseTo(.3,1);
  } finally {scene.close();world.dispose();}
});

async function addFixture(world, scene, manifest, factory, position) {
  await world.assetModule.registerManifest(manifest);
  world.assetModule.loader.registerFactory(manifest.id,factory);
  await scene.addModel({id:manifest.id,asset:`builtin://${manifest.id}`,position});
}

it('rotates a wheel with torque and verifies its actual orientation and rest state', async () => {
  const {scene,world} = await setup();
  try {
    await scene.remove({id:'new_crate'});
    await addFixture(world,scene,{id:'unseen_wheel',type:'wheel',source:{kind:'builtin'},actions:[],
      physics:{body:'dynamic',mass:2,lockTranslation:[true,true,true],lockRotation:[true,false,true],
        colliders:[{shape:'cylinder',radius:.3,halfHeight:.08}]}},
    ()=>new THREE.Mesh(new THREE.CylinderGeometry(.3,.3,.16),new THREE.MeshStandardMaterial()),[.85,.8,0]);
    const torque = vi.spyOn(world.physics,'applyTorque');
    const result = await finish(scene,scene.interact({actor:'actor',target:'unseen_wheel',action:'rotate',args:{axis:[0,1,0],angle:1}}));
    expect(result,JSON.stringify(result)).toMatchObject({status:'succeeded',result:{value:{evidenceKind:'rigid-body-torque',physicsVerified:true}}});
    expect(result.result.value.progress).toBeCloseTo(1,1); expect(torque).toHaveBeenCalled();
  } finally {scene.close();world.dispose();}
});

it.each(['prismatic','revolute'])('controls an unlabelled %s joint using limits and verifies solver completion', async jointType => {
  const {scene,world} = await setup();
  try {
    await scene.remove({id:'new_crate'});
    const manifest = {id:'unseen_drawer',type:'drawer',source:{kind:'builtin'},actions:[],
      physics:{body:'fixed',colliders:[{shape:'box',halfExtents:[.1,.1,.1],translation:[0,-.4,0]}]},
      parts:{drawer:{node:'Drawer',actions:[],targets:{},physics:{body:'dynamic',mass:1,colliders:[{shape:'box',halfExtents:[.2,.1,.2]}]},
        joint:{type:jointType,axis:jointType === 'prismatic' ? [0,0,1] : [0,1,0],limits:[0,.5],parentAnchor:[0,0,0],childAnchor:[0,0,0],motor:{stiffness:80,damping:12}}}}};
    await addFixture(world,scene,manifest,()=>{
      const root = new THREE.Group(), drawer = new THREE.Mesh(new THREE.BoxGeometry(.4,.2,.4),new THREE.MeshStandardMaterial());
      drawer.name='Drawer';root.add(drawer);return root;
    },[.85,.8,0]);
    const action = jointType === 'prismatic' ? 'slide' : 'rotateJoint';
    expect(scene.inspect('unseen_drawer',{actor:'actor'}).actions.find(entry=>entry.action===action).available).toBe(true);
    const result = await finish(scene,scene.interact({actor:'actor',target:'unseen_drawer',action,args:{part:'drawer',target:.3}}));
    expect(result,JSON.stringify(result)).toMatchObject({status:'succeeded',result:{value:{evidenceKind:'joint-motor',physicsVerified:true,coordinate:expect.any(Number)}}});
    expect(world.physics.getArticulationState('unseen_drawer','drawer').coordinate).toBeCloseTo(.3,1);
    // Numeric joint poses survive the existing history path without a semantic action label.
    expect(await world.history.undo()).toBeTruthy();
    expect(world.physics.getArticulationState('unseen_drawer','drawer').coordinate).toBeCloseTo(0,1);
    expect(await world.history.redo()).toBeTruthy();
    expect(world.physics.getArticulationState('unseen_drawer','drawer').coordinate).toBeCloseTo(.3,1);
    const invalid = await finish(scene,scene.interact({actor:'actor',target:'unseen_drawer',action,args:{part:'drawer',target:.7}}));
    expect(invalid).toMatchObject({status:'failed',result:{value:{reason:'JOINT_LIMIT_EXCEEDED'}}});
  } finally {scene.close();world.dispose();}
});

it('cancels an active force task without teleporting or continuing to apply forces', async () => {
  const {scene,world} = await setup();
  try {
    const force = vi.spyOn(world.physics,'applyForce');
    const task = scene.interact({actor:'actor',target:'new_crate',action:'push',args:{direction:[1,0,0],distance:1}});
    for(let n=0;n<45;n++) { scene.step();await Promise.resolve(); }
    expect(force).toHaveBeenCalled();
    expect(scene.inspect('new_crate').pending).toBe(true);
    const position = world.physics.getPosition('new_crate')[0];
    scene.cancelJob(task.id);
    const count = force.mock.calls.length;
    const result = await finish(scene,task);
    expect(result).toMatchObject({status:'cancelled',result:{verification:{status:'unverified'}}});
    expect(force.mock.calls.length).toBe(count);
    expect(world.physics.getPosition('new_crate')[0]).toBeGreaterThanOrEqual(position-.01);
    expect(world.interactions.physicalTasks.size).toBe(0);
  } finally {scene.close();world.dispose();}
});

it('rejects invalid inputs and never enables force actions for fixed or held objects', async () => {
  const {scene,world} = await setup();
  try {
    for (const args of [{direction:[0,0,0],distance:1},{direction:[0,1,0],distance:1},{direction:[1,0,0],distance:-1},{direction:[1,0,0],distance:1,maxForce:Infinity}]) {
      expect(()=>scene.interact({actor:'actor',target:'new_crate',action:'push',args})).toThrow();
    }
    await scene.addModel({id:'fixed_chair',asset:'builtin://chair',position:[2,0,0]});
    expect(scene.inspect('fixed_chair').actions.find(entry=>entry.action==='push')).toMatchObject({available:false,reason:'TARGET_NOT_DYNAMIC'});
    const result = await finish(scene,scene.interact({actor:'actor',target:'fixed_chair',action:'push',args:{direction:[1,0,0],distance:1}}));
    expect(result).toMatchObject({status:'failed',result:{value:{reason:'TARGET_NOT_DYNAMIC'}}});
  } finally {scene.close();world.dispose();}
});
