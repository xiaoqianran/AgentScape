import { createRapierPhysicsSystem } from '../helpers/createRapierPhysicsSystem.js';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { ObjectStore } from '../../world/runtime/ObjectStore.js';
import { assetManifests } from '../../asset/manifests/index.js';

const cabinetObject=()=>{
  const root=new THREE.Group();
  const body=new THREE.Mesh(new THREE.BoxGeometry(1.7,2,.64)); body.position.set(0,1,-.04); body.name='Body'; root.add(body);
  const hinge=new THREE.Group(); hinge.name='doorHinge'; hinge.position.set(-.82,1,.39); root.add(hinge);
  const door=new THREE.Mesh(new THREE.BoxGeometry(1.62,1.9,.08)); door.name='Door'; door.position.set(.81,0,0); hinge.add(door);
  root.updateMatrixWorld(true); return root;
};

const blockerManifest={
  id:'blocker',type:'prop',source:{kind:'builtin'},actions:[],
  physics:{body:'fixed',colliders:[{shape:'box',halfExtents:[.18,1,.18]}]}
};

async function cabinetPhysics(){
  const physics=createRapierPhysicsSystem(); await physics.init();
  const store=new ObjectStore();
  const object=cabinetObject(); const manifest=structuredClone(assetManifests.cabinet);
  store.add('cabinet',{id:'cabinet',assetId:'cabinet',object,manifest,state:{}});
  physics.attach('cabinet',manifest,object);
  return {physics,store};
}

const runOpen=(physics,store,steps=180)=>{
  physics.setArticulationTarget('cabinet','door',-1.35);
  for(let i=0;i<steps;i++) physics.step(1/60,store);
};

describe('Physics collider contact provenance',()=>{
  it('attributes a live articulated contact to a named environment collider',async()=>{
    const {physics,store}=await cabinetPhysics();
    physics.addEnvironment([{shape:'box',halfExtents:[.18,1,.18],translation:[-.64,1,1.08]}],{id:'stall-fixture'});
    runOpen(physics,store);
    const contacts=physics.articulationContacts('cabinet','door');
    const hit=contacts.find((item)=>item.target.kind==='environment'&&item.target.environmentId==='stall-fixture');
    expect(hit).toMatchObject({
      source:{kind:'object',objectId:'cabinet',partName:'door',colliderIndex:0},
      target:{kind:'environment',environmentId:'stall-fixture',colliderIndex:0},
      external:true,manifoldCount:expect.any(Number),contactCount:expect.any(Number),
      evidenceKind:'solver-contact',impulseAvailable:true,normal:expect.any(Array)
    });
    expect(hit.manifoldCount).toBeGreaterThan(0);
    expect(hit.contactCount).toBeGreaterThan(0);
    expect(hit.activeContactCount).toBeGreaterThan(0);
    expect(Number.isFinite(hit.minDistance)).toBe(true);
    expect(Number.isFinite(hit.totalImpulse)).toBe(true);
    expect(hit.totalImpulse).toBeGreaterThanOrEqual(0);
    expect(JSON.stringify(hit)).not.toMatch(/handle/);
    physics.dispose();
  });

  it('attributes a live articulated contact to a named object and cleans provenance on remove',async()=>{
    const {physics,store}=await cabinetPhysics();
    const blocker=new THREE.Group(); blocker.position.set(-.64,1,1.08); blocker.updateMatrixWorld(true);
    store.add('blocker_01',{id:'blocker_01',assetId:'blocker',object:blocker,manifest:blockerManifest,state:{}});
    physics.attach('blocker_01',blockerManifest,blocker);
    const blockerCollider=physics.entries.get('blocker_01').body.collider(0);
    expect(physics.provenanceOfCollider(blockerCollider)).toEqual({kind:'object',objectId:'blocker_01',partName:'$root',colliderIndex:0});
    runOpen(physics,store);
    const hit=physics.articulationContacts('cabinet','door').find((item)=>item.target.objectId==='blocker_01');
    expect(hit).toMatchObject({target:{kind:'object',objectId:'blocker_01',partName:'$root',colliderIndex:0},external:true});
    const handle=blockerCollider.handle;
    expect(physics.colliderProvenance.has(handle)).toBe(true);
    expect(physics.remove('blocker_01')).toBe(true);
    expect(physics.colliderProvenance.has(handle)).toBe(false);
    physics.dispose();
    expect(physics.colliderProvenance.size).toBe(0);
  });

  it('unregisterBodyColliders removes collider-level provenance without mutating the body',async()=>{
    const physics=createRapierPhysicsSystem(); await physics.init();
    const body=physics.addEnvironment([{shape:'box',halfExtents:[.2,.2,.2]}],{id:'temporary-env'});
    const collider=body.collider(0);
    expect(physics.provenanceOfCollider(collider)).toEqual({kind:'environment',environmentId:'temporary-env',colliderIndex:0});
    physics.unregisterBodyColliders(body);
    expect(physics.provenanceOfCollider(collider)).toBeNull();
    expect(body.numColliders()).toBe(1);
    physics.dispose();
  });

});
