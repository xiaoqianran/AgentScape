import { createRapierPhysicsSystem } from '../helpers/createRapierPhysicsSystem.js';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { EventBus } from '../../core/EventBus.js';
import { ObjectStore } from '../../world/runtime/ObjectStore.js';
import { SpatialSystem } from '../../world/runtime/systems/SpatialSystem.js';
import { createRecastNavigationSystem } from '../helpers/createRecastNavigationSystem.js';
import { LocomotionSystem } from '../../world/runtime/systems/LocomotionSystem.js';
import { InteractionSystem } from '../../world/runtime/systems/InteractionSystem.js';
import { assetManifests } from '../../asset/manifests/index.js';

const floor=()=>{const m=new THREE.Mesh(new THREE.BoxGeometry(12,.2,12));m.position.y=-.1;m.updateMatrixWorld(true);return m;};
const cupVisual=()=>{const g=new THREE.Group();const m=new THREE.Mesh(new THREE.CylinderGeometry(.15,.15,.32,16));m.position.y=.16;g.add(m);return g;};
const tableVisual=()=>{const g=new THREE.Group();const top=new THREE.Mesh(new THREE.BoxGeometry(2.4,.16,1.25));top.position.y=1;g.add(top);g.updateMatrixWorld(true);return g;};

async function setup({tablePhysics=true, blocker=null}={}){
  const store=new ObjectStore(), scene=new THREE.Scene(), ground=floor(); scene.add(ground);
  const physics=createRapierPhysicsSystem(); await physics.init();
  const env=[{shape:'box',halfExtents:[6,.1,6],translation:[0,-.1,0]}]; if(blocker) env.push(blocker); physics.addEnvironment(env);
  const agent=new THREE.Group(); agent.position.set(0,0,3.2); scene.add(agent); agent.updateMatrixWorld(true);
  const am=structuredClone(assetManifests.agent); store.add('agent_01',{id:'agent_01',assetId:'agent',object:agent,manifest:am,state:{}}); physics.attach('agent_01',am,agent);
  const cup=cupVisual(); cup.position.set(0,.95,2.58); scene.add(cup); cup.updateMatrixWorld(true);
  const cm=structuredClone(assetManifests.cup); store.add('cup_01',{id:'cup_01',assetId:'cup',object:cup,manifest:cm,state:{heldBy:{kind:'agent',id:'agent_01',anchor:'hold'}}}); physics.attach('cup_01',cm,cup);
  const table=tableVisual(); table.position.set(0,0,0); scene.add(table); table.updateMatrixWorld(true);
  const tm=structuredClone(assetManifests.table); store.add('table_01',{id:'table_01',assetId:'table',object:table,manifest:tm,state:{}}); if(tablePhysics) physics.attach('table_01',tm,table);
  physics.step(1/60,store);
  const spatial=new SpatialSystem({store,scene}), events=new EventBus();
  const navigation=createRecastNavigationSystem({store,physics,environmentRoots:[ground],events});
  const locomotion=new LocomotionSystem({store,physics,navigation,events});
  const interactions=new InteractionSystem({store,physics,spatial,navigation,locomotion,events}); interactions.rebuildHeldOwnership();
  return {store,scene,physics,spatial,navigation,locomotion,interactions};
}

async function drive(promise,ctx,max=1500){
  let done=false,result,error;promise.then(v=>{done=true;result=v},e=>{done=true;error=e});
  for(let i=0;i<150&&!done&&ctx.locomotion.tasks.size===0&&ctx.interactions.settleTasks.size===0;i++) await new Promise(r=>setTimeout(r,0));
  for(let i=0;i<max&&!done;i++){ctx.locomotion.update(1/60);ctx.physics.step(1/60,ctx.store);ctx.interactions.update(1/60,{position:[0,0,0],rotation:[0,0,0,1]});await Promise.resolve();}
  if(error) throw error;if(!done) throw new Error('place task did not settle');return result;
}

describe('agent-held place/release truth',()=>{
  it('approaches a table, releases through a collision-checked trajectory, settles dynamically, and verifies support',async()=>{
    const ctx=await setup();
    const result=await drive(ctx.interactions.approachAndPlace('agent_01','table_01',{surfaceId:'top',speed:2.5}),ctx);
    expect(result).toMatchObject({status:'placed',supportVerified:true,settled:true,actorId:'agent_01',targetId:'table_01',heldId:'cup_01',stillHeld:false});
    expect(result.arrivalCorrection).toMatchObject({status:'arrived',id:'agent_01'});
    const actorPosition=ctx.physics.getPosition('agent_01');
    expect(Math.hypot(actorPosition[0]-result.pose.position[0],actorPosition[2]-result.pose.position[2])).toBeLessThanOrEqual(.051);
    expect(result.transfer).toHaveLength(3);
    expect(result.transfer.every((step)=>step.clear)).toBe(true);
    expect(ctx.store.get('cup_01').state.heldBy).toBeUndefined();
    expect(ctx.physics.entries.get('cup_01').body.isDynamic()).toBe(true);
    expect(ctx.spatial.supportStatus('cup_01','table_01',{surfaceId:'top'}).on).toBe(true);
    expect(ctx.interactions.carryStatus('agent_01')).toMatchObject({status:'empty'});
    ctx.navigation.dispose();ctx.physics.dispose();
  },30000);

  it('does not claim placed when a declared surface lacks matching physical support and the released Cup falls away',async()=>{
    const ctx=await setup({tablePhysics:false});
    // Let LOS still hit a target-owned physics body well below the declared top surface.
    const tableRecord=ctx.store.get('table_01');
    const fake=structuredClone(tableRecord.manifest); fake.physics={body:'fixed',colliders:[{shape:'box',halfExtents:[1.1,.1,.05],translation:[0,1,.4]}]};
    ctx.physics.attach('table_01',fake,tableRecord.object);
    const result=await drive(ctx.interactions.approachAndPlace('agent_01','table_01',{surfaceId:'top',speed:2.5}),ctx);
    expect(result).toMatchObject({status:'place-failed',reason:'SUPPORT_NOT_REACHED',supportVerified:false,settled:true,stillHeld:false});
    expect(result.support.on).toBe(false);
    expect(ctx.store.get('cup_01').state.heldBy).toBeUndefined();
    ctx.navigation.dispose();ctx.physics.dispose();
  },30000);

  it('keeps ownership when a physical blocker intersects the kinematic release trajectory',async()=>{
    const ctx=await setup({blocker:{shape:'box',halfExtents:[.35,.12,.35],translation:[0,1.55,0]}});
    const result=await drive(ctx.interactions.approachAndPlace('agent_01','table_01',{surfaceId:'top',speed:2.5}),ctx);
    expect(result).toMatchObject({status:'place-blocked',reason:'PLACE_TRANSFER_BLOCKED',heldId:'cup_01',stillHeld:true});
    expect(result.transfer.some((step)=>!step.clear)).toBe(true);
    expect(ctx.store.get('cup_01').state.heldBy).toEqual({kind:'agent',id:'agent_01',anchor:'hold'});
    expect(ctx.physics.entries.get('cup_01').body.isKinematic()).toBe(true);
    ctx.navigation.dispose();ctx.physics.dispose();
  },30000);
});
