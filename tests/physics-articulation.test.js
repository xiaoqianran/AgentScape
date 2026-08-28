import { createRapierPhysicsSystem } from './helpers/createRapierPhysicsSystem.js';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { PhysicsSystem } from '../src/runtime/systems/PhysicsSystem.js';
import { ObjectStore } from '../src/runtime/ObjectStore.js';

const manifest = {
  id: 'cabinet', type: 'cabinet', source: { kind: 'builtin' }, actions: ['open', 'close', 'move'],
  physics: { body: 'fixed', colliders: [{ shape: 'box', halfExtents: [.85, 1, .32], translation: [0, 1, -.04] }] },
  parts: {
    door: {
      node: 'doorHinge', actions: ['open', 'close'], targets: { open:-1.35, close:0 },
      physics: { body: 'dynamic', mass: 8, colliders: [{ shape: 'box', halfExtents: [.81, .95, .04], translation: [.81, 0, 0] }] },
      joint: { type: 'revolute', axis: [0, 1, 0], limits: [-1.35, 0], parentAnchor: [-.82, 1, .39], childAnchor: [0, 0, 0], motor: { stiffness: 45, damping: 9 } }
    }
  }
};

describe('PhysicsSystem articulation', () => {
  it('drives a revolute part toward the requested target', async () => {
    const physics = createRapierPhysicsSystem();
    await physics.init();
    const root = new THREE.Group();
    const hinge = new THREE.Group();
    hinge.name = 'doorHinge';
    hinge.position.set(-.82, 1, .39);
    root.add(hinge);
    root.updateMatrixWorld(true);

    const store = new ObjectStore();
    store.add('cabinet_01', { id: 'cabinet_01', assetId: 'cabinet', object: root, manifest, state: {} });
    physics.attach('cabinet_01', manifest, root);
    expect(physics.setArticulationTarget('cabinet_01', 'door', -1)).toBe(true);

    for (let i = 0; i < 180; i++) physics.step(1 / 60, store);
    expect(Math.abs(hinge.rotation.y)).toBeGreaterThan(.2);
    expect(hinge.rotation.y).toBeGreaterThan(-1.4);
    expect(hinge.rotation.y).toBeLessThan(.1);
    const state=physics.articulationState('cabinet_01','door',{target:-1});
    expect(state).toMatchObject({jointType:'revolute',target:-1,tolerance:.08,coordinateReference:'rest-zero-pose'});
    expect(state.coordinate).toBeLessThan(-.2);
    expect(state.error).toBeLessThan(.2);
    expect(state.localAxis[1]).toBeCloseTo(1,5);
    physics.dispose();
  });

  it('observes a prismatic joint in the same rest-zero-pose coordinate contract', async () => {
    const physics=createRapierPhysicsSystem(); await physics.init();
    const root=new THREE.Group();
    const slide=new THREE.Group(); slide.name='Slide'; root.add(slide); root.updateMatrixWorld(true);
    const prismatic={
      id:'drawer',type:'drawer',source:{kind:'builtin'},actions:['open','close'],
      physics:{body:'fixed',colliders:[{shape:'box',halfExtents:[.5,.5,.5]}]},
      parts:{drawer:{node:'Slide',actions:['open','close'],targets:{open:.5,close:0},physics:{body:'dynamic',mass:1,colliders:[{shape:'box',halfExtents:[.1,.1,.1]}]},joint:{type:'prismatic',axis:[1,0,0],limits:[0,.5],parentAnchor:[0,0,0],childAnchor:[0,0,0],motor:{stiffness:40,damping:8}}}}
    };
    const store=new ObjectStore(); store.add('drawer_01',{id:'drawer_01',assetId:'drawer',object:root,manifest:prismatic,state:{}});
    physics.attach('drawer_01',prismatic,root);
    expect(physics.setArticulationTarget('drawer_01','drawer',.5)).toBe(true);
    for(let i=0;i<180;i++) physics.step(1/60,store);
    const state=physics.articulationState('drawer_01','drawer',{target:.5});
    expect(state).toMatchObject({jointType:'prismatic',target:.5,tolerance:.03,coordinateReference:'rest-zero-pose'});
    expect(state.coordinate).toBeGreaterThan(.35);
    expect(state.error).toBeLessThan(.15);
    expect(state.localAxis[0]).toBeCloseTo(1,5);
    expect(physics.holdArticulationCurrent('drawer_01','drawer')).toBe(true);
    physics.dispose();
  });
});
