import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { AssetManager } from '../../asset/AssetManager.js';
import { assetAdmission } from '../../asset/admission.js';
import { ObjectStore } from '../../world/runtime/ObjectStore.js';
import { composeObservedNearPlacement } from '../../world/compiler/WorldComposer.js';
import { createRapierPhysicsSystem } from '../helpers/createRapierPhysicsSystem.js';
import { createRecastNavigationSystem } from '../helpers/createRecastNavigationSystem.js';

const floor=()=>{
  const mesh=new THREE.Mesh(new THREE.BoxGeometry(10,.2,10));
  mesh.position.y=-.1; mesh.updateMatrixWorld(true); return mesh;
};

describe('Generated World hybrid composition',()=>{
  it('keeps observed semantics outside ObjectStore while admitting a real executable asset into shared Physics/Navigation',async()=>{
    const assets=new AssetManager();
    const manifest=assets.getManifest('cup');
    expect(assetAdmission(manifest).status).toBe('ready');

    const store=new ObjectStore();
    const physics=createRapierPhysicsSystem(); await physics.init();
    physics.addEnvironment([
      {shape:'box',halfExtents:[5,.1,5],translation:[0,-.1,0]},
      {shape:'box',halfExtents:[.5,.5,.5],translation:[0,.5,0]}
    ],{id:'generated-background'});

    const observation={id:'hyworld2-target-1',label:'bench',localization:{kind:'point-scale',center:[0,0,0],scale:.2}};
    const plan=composeObservedNearPlacement(manifest,observation,{
      layout:{bounds:{min:[-5,-5],max:[5,5]},groundY:0,margin:.5},
      poseClear:(candidate,position)=>physics.manifestPoseClear(candidate,position)
    });
    expect(plan).toMatchObject({checked:true,status:'ready',collisionVerified:true,observationId:'hyworld2-target-1'});
    expect(physics.manifestPoseClear(manifest,plan.position)).toMatchObject({checked:true,clear:true});

    const {object}=await assets.instantiate('cup');
    object.position.fromArray(plan.position); object.updateMatrixWorld(true);
    store.add('hybrid_cup_01',{id:'hybrid_cup_01',assetId:'cup',object,manifest,state:{}});
    physics.attach('hybrid_cup_01',manifest,object);
    for(let i=0;i<240;i++) physics.step(1/60,store);
    const motion=physics.bodyMotionState('hybrid_cup_01');
    expect(motion.sleeping || (motion.linearSpeed<.04 && motion.angularSpeed<.12)).toBe(true);
    expect(store.has('hybrid_cup_01')).toBe(true);
    expect(store.list().some(([id])=>id.startsWith('semantic-instance:'))).toBe(false);

    const navigation=createRecastNavigationSystem({store,physics,environmentRoots:[floor()]});
    const route=await navigation.findPath([-4,0,-3],[4,0,-3]);
    expect(route.reachable).toBe(true);
    expect(navigation.status()).toMatchObject({state:'ready',dynamicObstacles:{tracked:1}});

    navigation.dispose(); physics.dispose();
  },20000);
});
