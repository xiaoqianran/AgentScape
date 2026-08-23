import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { EventBus } from '../src/core/EventBus.js';
import { ObjectStore } from '../src/runtime/ObjectStore.js';
import { SpatialSystem } from '../src/runtime/systems/SpatialSystem.js';
import { PhysicsSystem } from '../src/runtime/systems/PhysicsSystem.js';
import { NavigationSystem } from '../src/runtime/systems/NavigationSystem.js';
import { LocomotionSystem } from '../src/runtime/systems/LocomotionSystem.js';
import { InteractionSystem } from '../src/runtime/systems/InteractionSystem.js';
import { assetManifests } from '../src/assets/manifests/index.js';

const floor = () => {
  const value = new THREE.Mesh(new THREE.BoxGeometry(10,.2,10));
  value.position.y=-.1; value.updateMatrixWorld(true); return value;
};

const cabinetObject = () => {
  const root=new THREE.Group();
  const body=new THREE.Mesh(new THREE.BoxGeometry(1.7,2,.64)); body.position.set(0,1,-.04); body.name='Body'; root.add(body);
  const hinge=new THREE.Group(); hinge.name='doorHinge'; hinge.position.set(-.82,1,.39); root.add(hinge);
  const door=new THREE.Mesh(new THREE.BoxGeometry(1.62,1.9,.08)); door.name='Door'; door.position.set(.81,0,0); hinge.add(door);
  root.updateMatrixWorld(true);
  return root;
};

async function setup({ wall=null }={}) {
  const store=new ObjectStore();
  const scene=new THREE.Scene();
  const ground=floor(); scene.add(ground);
  const physics=new PhysicsSystem(); await physics.init();
  const colliders=[{shape:'box',halfExtents:[5,.1,5],translation:[0,-.1,0]}];
  if(wall) colliders.push(wall);
  physics.addEnvironment(colliders);

  const agent=new THREE.Group(); agent.position.set(0,0,4); agent.updateMatrixWorld(true); scene.add(agent);
  const agentManifest=structuredClone(assetManifests.agent);
  store.add('agent_01',{id:'agent_01',assetId:'agent',object:agent,manifest:agentManifest,state:{}});
  physics.attach('agent_01',agentManifest,agent);

  const cabinet=cabinetObject(); scene.add(cabinet);
  const cabinetManifest=structuredClone(assetManifests.cabinet);
  store.add('cabinet_01',{id:'cabinet_01',assetId:'cabinet',object:cabinet,manifest:cabinetManifest,state:{parts:{door:'close'}}});
  physics.attach('cabinet_01',cabinetManifest,cabinet);
  physics.step(1/60,store);

  const spatial=new SpatialSystem({store,scene});
  const events=new EventBus();
  const navigation=new NavigationSystem({store,physics,environmentRoots:[ground],events});
  const locomotion=new LocomotionSystem({store,physics,navigation,events});
  const interactions=new InteractionSystem({store,physics,spatial,navigation,locomotion,events});
  return {store,scene,ground,physics,spatial,navigation,locomotion,interactions};
}

async function drive(promise, locomotion, physics, store, max=900) {
  let done=false, result, error;
  promise.then((value)=>{done=true;result=value;},(value)=>{done=true;error=value;});
  for(let i=0;i<120&&!done&&locomotion.tasks.size===0;i++) await new Promise((resolve)=>setTimeout(resolve,0));
  for(let i=0;i<max&&!done;i++){
    locomotion.update(1/60);
    physics.step(1/60,store);
    await Promise.resolve();
  }
  if(!done) await Promise.race([promise.then((value)=>{result=value;done=true;}),new Promise((_,reject)=>setTimeout(()=>reject(new Error('interaction task did not settle')),1000))]);
  if(error) throw error;
  return result;
}

describe('interaction-range task execution',()=>{
  it('finds a Detour-reachable pose with physical line of sight around an articulated cabinet',async()=>{
    const ctx=await setup();
    const sweep=ctx.interactions.actionSweepBounds('cabinet_01','open','door');
    const unsafeFront=ctx.interactions.actorBoxAt('agent_01',[0,.1,.87]);
    expect(sweep.checked).toBe(true);
    expect(sweep.box.intersectsBox(unsafeFront)).toBe(true);
    const pose=await ctx.interactions.findInteractionPose('agent_01','cabinet_01',{action:'open',partName:'door'});
    expect(pose).toMatchObject({status:'approach-pose',actionSweep:{checked:true,clear:true,partName:'door'}});
    expect(sweep.box.intersectsBox(ctx.interactions.actorBoxAt('agent_01',pose.position))).toBe(false);
    expect(pose.routeCost).toBeGreaterThan(1);
    expect(pose.distance).toBeLessThanOrEqual(1.5);
    expect(pose.lineOfSight.hit.id).toBe('cabinet_01');
    ctx.navigation.dispose(); ctx.physics.dispose();
  },15000);

  it('walks to a verified interaction pose before issuing a real articulation open command',async()=>{
    const ctx=await setup();
    const task=ctx.interactions.approachAndInteract('agent_01','cabinet_01','open',{partName:'door',speed:2.5});
    const result=await drive(task,ctx.locomotion,ctx.physics,ctx.store);
    expect(result).toMatchObject({status:'interaction-requested',action:'open',interaction:{requested:true}});
    expect(result.locomotion.status).toBe('arrived');
    expect(result.reach).toMatchObject({inRange:true,visible:true,interactable:true});
    expect(result.reach.distance).toBeLessThanOrEqual(1.5);
    expect(ctx.store.get('cabinet_01').state.parts.door).toBe('open');
    const hinge=ctx.store.get('cabinet_01').object.getObjectByName('doorHinge');
    const initial=hinge.quaternion.clone();
    for(let i=0;i<240;i++) ctx.physics.step(1/60,ctx.store);
    expect(hinge.quaternion.angleTo(initial)).toBeGreaterThan(.5);
    const closeSweep=ctx.interactions.actionSweepBounds('cabinet_01','close','door');
    expect(closeSweep.checked).toBe(true);
    expect(Math.abs(closeSweep.currentCoordinate)).toBeGreaterThan(.5);
    expect(closeSweep.target).toBe(0);
    const actor=ctx.physics.getPosition('agent_01');
    expect(Math.hypot(actor[0],actor[2]-4)).toBeGreaterThan(1);
    ctx.navigation.dispose(); ctx.physics.dispose();
  },20000);

  it('does not treat proximity through a physical wall as interactability',async()=>{
    const ctx=await setup({wall:{shape:'box',halfExtents:[1.4,1.5,.08],translation:[0,1.5,1.6]}});
    const status=ctx.interactions.interactionStatusAt('agent_01','cabinet_01',[0,0,2.3],{maxDistance:2.5});
    expect(status.inRange).toBe(true);
    expect(status.visible).toBe(false);
    expect(status.interactable).toBe(false);
    expect(status.lineOfSight.hit).toMatchObject({id:null,environment:true});
    ctx.navigation.dispose(); ctx.physics.dispose();
  },15000);

  it('rechecks the actual Rapier arrival pose and refuses to start a door sweep if the agent drifted into it',async()=>{
    const ctx=await setup();
    const originalNavigate=ctx.locomotion.navigate.bind(ctx.locomotion);
    ctx.locomotion.navigate=async()=>{
      ctx.physics.setPosition('agent_01',[0,.1,.87]);
      ctx.physics.step(1/60,ctx.store);
      return {status:'arrived',id:'agent_01',position:[0,.1,.87]};
    };
    await expect(ctx.interactions.approachAndInteract('agent_01','cabinet_01','open',{partName:'door'})).rejects.toMatchObject({
      code:'INTERACTION_UNAVAILABLE',details:expect.objectContaining({reason:'AGENT_BLOCKS_ACTION_SWEEP'})
    });
    expect(ctx.store.get('cabinet_01').state.parts.door).toBe('close');
    ctx.locomotion.navigate=originalNavigate;
    ctx.navigation.dispose(); ctx.physics.dispose();
  },15000);

});
