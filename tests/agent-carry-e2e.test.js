import { createRapierPhysicsSystem } from './helpers/createRapierPhysicsSystem.js';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { EventBus } from '../src/core/EventBus.js';
import { ObjectStore } from '../src/runtime/ObjectStore.js';
import { SpatialSystem } from '../src/runtime/systems/SpatialSystem.js';
import { createRecastNavigationSystem } from './helpers/createRecastNavigationSystem.js';
import { LocomotionSystem } from '../src/runtime/systems/LocomotionSystem.js';
import { InteractionSystem } from '../src/runtime/systems/InteractionSystem.js';
import { assetManifests } from '../src/assets/manifests/index.js';

const floorMesh=()=>{ const m=new THREE.Mesh(new THREE.BoxGeometry(10,.2,10)); m.position.y=-.1; m.updateMatrixWorld(true); return m; };
const cupVisual=()=>{ const g=new THREE.Group(); const m=new THREE.Mesh(new THREE.CylinderGeometry(.15,.15,.32,16)); m.position.y=.16; g.add(m); return g; };

async function setup({agent=[0,0,3],cup=[0,0,0],table=null,wall=null}={}){
  const store=new ObjectStore(); const scene=new THREE.Scene(); const ground=floorMesh(); scene.add(ground);
  const physics=createRapierPhysicsSystem(); await physics.init();
  const env=[{shape:'box',halfExtents:[5,.1,5],translation:[0,-.1,0]}]; if(wall) env.push(wall); physics.addEnvironment(env);
  const a=new THREE.Group(); a.position.fromArray(agent); scene.add(a); a.updateMatrixWorld(true);
  const am=structuredClone(assetManifests.agent); store.add('agent_01',{id:'agent_01',assetId:'agent',object:a,manifest:am,state:{}}); physics.attach('agent_01',am,a);
  if(table){
    const t=new THREE.Group();
    const top=new THREE.Mesh(new THREE.BoxGeometry(2.4,.16,1.25)); top.position.y=1; t.add(top);
    t.position.fromArray(table); scene.add(t); t.updateMatrixWorld(true);
    const tm=structuredClone(assetManifests.table); store.add('table_01',{id:'table_01',assetId:'table',object:t,manifest:tm,state:{}}); physics.attach('table_01',tm,t);
  }
  const c=cupVisual(); c.position.fromArray(cup); scene.add(c); c.updateMatrixWorld(true);
  const cm=structuredClone(assetManifests.cup); store.add('cup_01',{id:'cup_01',assetId:'cup',object:c,manifest:cm,state:{}}); physics.attach('cup_01',cm,c);
  for(let i=0;i<(table?120:10);i++) physics.step(1/60,store);
  const spatial=new SpatialSystem({store,scene}); const events=new EventBus();
  const navigation=createRecastNavigationSystem({store,physics,environmentRoots:[ground],events});
  const locomotion=new LocomotionSystem({store,physics,navigation,events});
  const interactions=new InteractionSystem({store,physics,spatial,navigation,locomotion,events});
  return {store,scene,ground,physics,spatial,navigation,locomotion,interactions};
}

async function drive(promise,ctx,max=1600){
  let done=false,result,error; promise.then(v=>{done=true;result=v},e=>{done=true;error=e});
  for(let i=0;i<1000&&!done&&ctx.locomotion.tasks.size===0&&ctx.interactions.settleTasks.size===0;i++) {
    await new Promise(r=>setTimeout(r,0));
  }
  for(let i=0;i<max&&!done;i++){
    ctx.locomotion.update(1/60);
    ctx.physics.step(1/60,ctx.store);
    ctx.interactions.update(1/60,new THREE.PerspectiveCamera());
    if(i%24===0) await new Promise(r=>setTimeout(r,0));
    else await Promise.resolve();
  }
  if(error) throw error;
  if(!done) throw new Error(`task did not settle · locomotion=${ctx.locomotion.tasks.size} settle=${ctx.interactions.settleTasks.size}`);
  return result;
}

describe('agent carry ownership',()=>{
  it('approaches, transfers a Cup to the Agent hold anchor, carries it, and restores Dynamic body on drop',async()=>{
    const ctx=await setup();
    const pickup=await drive(ctx.interactions.approachAndPickup('agent_01','cup_01',{speed:2.5}),ctx);
    expect(pickup).toMatchObject({status:'held',actorId:'agent_01',targetId:'cup_01',attachment:'kinematic-anchor',graspVerified:false,transfer:{clear:true}});
    expect(ctx.store.get('cup_01').state.heldBy).toEqual({kind:'agent',id:'agent_01',anchor:'hold'});
    expect(ctx.physics.entries.get('cup_01').body.isKinematic()).toBe(true);
    expect(ctx.physics.navigationObstacles().items.some((item)=>item.objectId==='cup_01')).toBe(false);
    expect(ctx.interactions.carryStatus('agent_01')).toMatchObject({status:'held',targetId:'cup_01',graspVerified:false});

    const move=await drive(ctx.locomotion.navigate('agent_01',[2,0,2],{speed:2.5}),ctx);
    expect(move.status).toBe('arrived');
    const anchor=ctx.physics.anchorPose('agent_01',ctx.store.get('agent_01').manifest.embodiment.holdAnchor);
    const cupPos=ctx.physics.getPosition('cup_01');
    expect(new THREE.Vector3(...cupPos).distanceTo(new THREE.Vector3(...anchor.position))).toBeLessThan(.06);

    const dropped=await drive(ctx.interactions.dropHeld('agent_01'),ctx);
    expect(dropped).toMatchObject({status:'dropped',targetId:'cup_01',released:true,settled:true,stillHeld:false});
    expect(ctx.store.get('cup_01').state.heldBy).toBeUndefined();
    expect(ctx.physics.entries.get('cup_01').body.isDynamic()).toBe(true);
    expect(ctx.physics.navigationObstacles().items.some((item)=>item.objectId==='cup_01')).toBe(true);
    ctx.navigation.dispose(); ctx.physics.dispose();
  },25000);

  it('blocks locomotion before a carried Cup reaches a physical wall even when the Agent capsule itself could advance',async()=>{
    const ctx=await setup({agent:[0,0,2],cup:[0,0,1.38],wall:{shape:'box',halfExtents:[2,1.5,.08],translation:[0,1.5,0]}});
    const record=ctx.store.get('cup_01'); record.state.heldBy={kind:'agent',id:'agent_01',anchor:'hold'};
    ctx.interactions.rebuildHeldOwnership();
    const pose=ctx.physics.anchorPose('agent_01',ctx.store.get('agent_01').manifest.embodiment.holdAnchor); ctx.physics.setHeldPose('cup_01',pose.position,pose.rotation);
    const current=await ctx.navigation.ensureCurrent();
    expect(current.success).toBe(true);
    const result=await drive(ctx.locomotion.navigate('agent_01',[0,0,-2],{speed:2.5,timeout:10}),ctx,700);
    expect(result).toMatchObject({status:'blocked',reason:'CARRIED_OBJECT_BLOCKED',carry:{id:'cup_01'}});
    expect(result.position[2]).toBeGreaterThan(.55);
    const cup=ctx.physics.getPosition('cup_01'); expect(cup[2]).toBeGreaterThan(-.05);
    ctx.navigation.dispose(); ctx.physics.dispose();
  },20000);

  it('picks up a Cup that is physically resting on the default Table support instead of treating support contact as a transfer blocker',async()=>{
    const ctx=await setup({agent:[0,0,3],table:[0,0,0],cup:[.35,1.4,0]});
    const before=ctx.physics.getPosition('cup_01');
    expect(before[1]).toBeGreaterThan(1);
    const pickup=await drive(ctx.interactions.approachAndPickup('agent_01','cup_01',{speed:2.5}),ctx);
    expect(pickup).toMatchObject({status:'held',actorId:'agent_01',targetId:'cup_01',transfer:{clear:true}});
    expect(ctx.store.get('cup_01').state.heldBy).toEqual({kind:'agent',id:'agent_01',anchor:'hold'});
    expect(ctx.physics.entries.get('cup_01').body.isKinematic()).toBe(true);
    ctx.navigation.dispose();ctx.physics.dispose();
  },25000);

});
