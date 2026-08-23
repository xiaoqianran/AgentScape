import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { ObjectStore } from '../src/runtime/ObjectStore.js';
import { PhysicsSystem } from '../src/runtime/systems/PhysicsSystem.js';
import { InteractionSystem } from '../src/runtime/systems/InteractionSystem.js';
import { assetManifests } from '../src/assets/manifests/index.js';

const cabinetObject=()=>{
  const root=new THREE.Group();
  const body=new THREE.Mesh(new THREE.BoxGeometry(1.7,2,.64)); body.position.set(0,1,-.04); body.name='Body'; root.add(body);
  const hinge=new THREE.Group(); hinge.name='doorHinge'; hinge.position.set(-.82,1,.39); root.add(hinge);
  const door=new THREE.Mesh(new THREE.BoxGeometry(1.62,1.9,.08)); door.name='Door'; door.position.set(.81,0,0); hinge.add(door);
  root.updateMatrixWorld(true); return root;
};

async function setup({blocker=false}={}){
  const store=new ObjectStore(); const physics=new PhysicsSystem(); await physics.init();
  if(blocker) physics.addEnvironment([{shape:'box',halfExtents:[.18,1,.18],translation:[-.64,1,1.08]}]);
  const object=cabinetObject(); const manifest=structuredClone(assetManifests.cabinet);
  store.add('cabinet',{id:'cabinet',assetId:'cabinet',object,manifest,state:{parts:{door:'close'}}});
  physics.attach('cabinet',manifest,object); physics.step(1/60,store);
  const interactions=new InteractionSystem({store,physics,spatial:{},events:{emit(){}}});
  return {store,physics,interactions};
}

async function drive(interactions,physics,store,promise,max=360){
  let done=false,result; promise.then((value)=>{done=true;result=value;});
  for(let i=0;i<max&&!done;i++){
    physics.step(1/60,store);
    interactions.update(1/60,null);
    await Promise.resolve();
  }
  if(!done) throw new Error('articulation observer did not settle');
  return result;
}

describe('live articulation completion',()=>{
  it('marks a motor action completed only after the live joint reaches and settles at target',async()=>{
    const ctx=await setup();
    const request=ctx.interactions.setArticulationAction('cabinet','open',{partName:'door'});
    expect(ctx.store.get('cabinet').state).toMatchObject({parts:{door:'close'},partTargets:{door:'open'}});
    const result=await drive(ctx.interactions,ctx.physics,ctx.store,ctx.interactions.waitForArticulationCompletion('cabinet','door','open',request.target));
    expect(result).toMatchObject({status:'action-completed',targetReached:true,settled:true,action:'open',partName:'door'});
    expect(result.error).toBeLessThanOrEqual(result.tolerance);
    expect(ctx.store.get('cabinet').state.parts.door).toBe('close');
    expect(ctx.store.get('cabinet').state.partTargets.door).toBe('open');
    expect(ctx.interactions.articulationStatus('cabinet','door').parts[0]).toMatchObject({status:'action-completed',verifiedAction:'close',requestedAction:'open'});
    expect(ctx.interactions.promoteArticulationCompletion(result)).toBe(true);
    expect(ctx.store.get('cabinet').state.parts.door).toBe('open');
    expect(ctx.store.get('cabinet').state.partTargets).toBeUndefined();
    ctx.physics.dispose();
  });

  it('returns STALL when a real external collider blocks the door and never promotes the request to verified open',async()=>{
    const ctx=await setup({blocker:true});
    const request=ctx.interactions.setArticulationAction('cabinet','open',{partName:'door'});
    const result=await drive(ctx.interactions,ctx.physics,ctx.store,ctx.interactions.waitForArticulationCompletion('cabinet','door','open',request.target));
    expect(result).toMatchObject({status:'action-failed',reason:'STALL',targetReached:false,settled:false,action:'open'});
    expect(result.error).toBeGreaterThan(result.tolerance);
    expect(result.recentMovement).toBeLessThan(.008);
    expect(ctx.store.get('cabinet').state.parts.door).toBe('close');
    expect(ctx.store.get('cabinet').state.partTargets.door).toBe('open');
    const status=ctx.interactions.articulationStatus('cabinet','door').parts[0];
    expect(status).toMatchObject({status:'action-failed',verifiedAction:'close',requestedAction:'open',last:{reason:'STALL'}});
    ctx.physics.dispose();
  });
});
