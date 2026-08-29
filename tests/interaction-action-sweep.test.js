import { createRapierPhysicsSystem } from './helpers/createRapierPhysicsSystem.js';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { ObjectStore } from '../world/runtime/ObjectStore.js';
import { SpatialSystem } from '../world/runtime/systems/SpatialSystem.js';
import { InteractionSystem } from '../world/runtime/systems/InteractionSystem.js';
import { assetManifests } from '../asset/manifests/index.js';

const drawerManifest={
  id:'drawer-test',type:'cabinet',source:{kind:'builtin'},actions:['open','close'],
  physics:{body:'fixed',colliders:[{shape:'box',halfExtents:[.8,.6,.7],translation:[0,.6,0]}]},
  parts:{drawer:{
    node:'Drawer',actions:['open','close'],targets:{open:1,close:0},
    physics:{body:'dynamic',mass:2,colliders:[{shape:'box',halfExtents:[.55,.18,.5]}]},
    joint:{type:'prismatic',axis:[0,0,1],limits:[0,1],parentAnchor:[0,.6,.5],childAnchor:[0,0,0],motor:{stiffness:50,damping:10}}
  }}
};

async function setup(manifest=drawerManifest){
  const store=new ObjectStore();
  const scene=new THREE.Scene();
  const physics=createRapierPhysicsSystem(); await physics.init();
  const agent=new THREE.Group(); agent.position.set(0,0,2); scene.add(agent); agent.updateMatrixWorld(true);
  const agentManifest=structuredClone(assetManifests.agent);
  store.add('agent_01',{id:'agent_01',assetId:'agent',object:agent,manifest:agentManifest,state:{}});
  physics.attach('agent_01',agentManifest,agent);
  const root=new THREE.Group();
  const body=new THREE.Mesh(new THREE.BoxGeometry(1.6,1.2,1.4)); body.position.y=.6; root.add(body);
  const drawer=new THREE.Mesh(new THREE.BoxGeometry(1.1,.36,1)); drawer.name='Drawer'; drawer.position.set(0,.6,.5); root.add(drawer);
  root.updateMatrixWorld(true); scene.add(root);
  store.add('drawer_01',{id:'drawer_01',assetId:'drawer-test',object:root,manifest,state:{parts:{drawer:'close'}}});
  physics.attach('drawer_01',manifest,root); physics.step(1/60,store);
  const spatial=new SpatialSystem({store,scene});
  const interactions=new InteractionSystem({store,physics,spatial,events:{emit(){}}});
  return {store,physics,interactions};
}

describe('articulation action swept bounds',()=>{
  it('covers a prismatic drawer extension and rejects an agent standing in front of it',async()=>{
    const {physics,interactions}=await setup();
    const sweep=interactions.actionSweepBounds('drawer_01','open','drawer');
    expect(sweep).toMatchObject({checked:true,partName:'drawer',action:'open',target:1});
    expect(sweep.bounds.max[2]-sweep.bounds.min[2]).toBeGreaterThan(1.8);
    expect(sweep.box.intersectsBox(interactions.actorBoxAt('agent_01',[0,0,1.6]))).toBe(true);
    expect(sweep.box.intersectsBox(interactions.actorBoxAt('agent_01',[1.5,0,.5]))).toBe(false);
    physics.dispose();
  });

  it('fails closed for a revolute joint with a non-zero child anchor instead of guessing the sweep frame',async()=>{
    const manifest=structuredClone(drawerManifest);
    manifest.parts.drawer.joint={...manifest.parts.drawer.joint,type:'revolute',axis:[0,1,0],limits:[-1,0],parentAnchor:[0,.6,.5],childAnchor:[.1,0,0]};
    manifest.parts.drawer.targets={open:-1,close:0};
    const {physics,interactions}=await setup(manifest);
    expect(interactions.actionSweepBounds('drawer_01','open','drawer')).toMatchObject({checked:false,reason:'REVOLUTE_CHILD_ANCHOR_UNSUPPORTED'});
    physics.dispose();
  });
});
