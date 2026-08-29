import * as THREE from 'three';
import { describe,expect,it } from 'vitest';
import { ObjectStore } from '../world/runtime/ObjectStore.js';
import { createJoltPhysicsSystem } from './helpers/createJoltPhysicsSystem.js';

const agentManifest={
  id:'agent-test',type:'agent',source:{kind:'builtin'},actions:['navigate'],
  physics:{body:'kinematic',navigationObstacle:false,colliders:[{shape:'capsule',halfHeight:.53,radius:.32,translation:[0,.85,0]}]}
};

const attachAgent=(physics,store,id='agent',position=[-2,0,0])=>{
  const object=new THREE.Group(); object.position.set(...position); object.updateMatrixWorld(true);
  store.add(id,{id,assetId:'agent',object,manifest:agentManifest,state:{}});
  physics.attach(id,agentManifest,object);
  return object;
};

describe('Jolt character controller parity',()=>{
  it('stops the translated kinematic capsule at a wall, stays grounded and reports collisions',async()=>{
    const physics=createJoltPhysicsSystem(); await physics.init();
    const store=new ObjectStore();
    physics.addEnvironment([
      {shape:'box',halfExtents:[4,.1,3],translation:[0,-.1,0]},
      {shape:'box',halfExtents:[.1,1.5,2.5],translation:[0,1.5,0]}
    ]);
    const object=attachAgent(physics,store);
    let last=null;
    try {
      for(let i=0;i<180;i++){
        last=physics.moveCharacter('agent',[.035,-.01,0]);
        expect(last.success).toBe(true);
        physics.step(1/60,store);
      }
      expect(object.position.x).toBeLessThan(-.38);
      expect(object.position.x).toBeGreaterThan(-.8);
      expect(object.position.y).toBeGreaterThan(-.02);
      expect(last.grounded).toBe(true);
      expect(last.collisions.length).toBeGreaterThan(0);
      expect(last.collisions[0]).toMatchObject({colliderHandle:expect.any(Number),normal:expect.any(Array)});
      expect(physics.navigationObstacles().items.find((item)=>item.objectId==='agent')).toBeUndefined();
    } finally { physics.dispose(); }
  });

  it('snaps a nearby character down to the floor without integrating solver gravity',async()=>{
    const physics=createJoltPhysicsSystem(); await physics.init();
    const store=new ObjectStore();
    physics.addEnvironment([{shape:'box',halfExtents:[3,.1,3],translation:[0,-.1,0]}]);
    const object=attachAgent(physics,store,'agent',[0,.18,0]);
    try {
      const result=physics.moveCharacter('agent',[.1,0,0]);
      expect(result.success).toBe(true);
      physics.step(1/60,store);
      expect(result.grounded).toBe(true);
      expect(object.position.y).toBeLessThan(.03);
      expect(object.position.y).toBeGreaterThan(-.02);
    } finally { physics.dispose(); }
  });

  it('walks up a low step through the backend autostep contract',async()=>{
    const physics=createJoltPhysicsSystem(); await physics.init();
    const store=new ObjectStore();
    physics.addEnvironment([
      {shape:'box',halfExtents:[3,.1,2],translation:[0,-.1,0]},
      {shape:'box',halfExtents:[.35,.1,1],translation:[0,.1,0]}
    ]);
    const object=attachAgent(physics,store,'agent',[-1.2,0,0]);
    let maxY=object.position.y;
    try {
      for(let i=0;i<60;i++){
        const result=physics.moveCharacter('agent',[.04,-.01,0]);
        expect(result.success).toBe(true);
        physics.step(1/60,store);
        maxY=Math.max(maxY,object.position.y);
      }
      expect(object.position.x).toBeGreaterThan(.65);
      expect(maxY).toBeGreaterThan(.12);
      expect(object.position.y).toBeLessThan(.05);
    } finally { physics.dispose(); }
  });


  it('enforces the configured max slope angle',async()=>{
    const run=async(degrees)=>{
      const physics=createJoltPhysicsSystem(); await physics.init();
      const store=new ObjectStore();
      const theta=degrees*Math.PI/180;
      const rotation=[0,0,Math.sin(theta/2),Math.cos(theta/2)];
      const centerY=Math.sin(theta)-.1*Math.cos(theta);
      physics.addEnvironment([
        {shape:'box',halfExtents:[4,.1,2],translation:[0,-.1,0]},
        {shape:'box',halfExtents:[1,.1,1],translation:[0,centerY,0],rotation}
      ]);
      const object=attachAgent(physics,store,'agent',[-1.8,0,0]);
      let maxY=0;
      try {
        for(let i=0;i<100;i++){
          const result=physics.moveCharacter('agent',[.04,-.01,0]);
          expect(result.success).toBe(true);
          physics.step(1/60,store);
          maxY=Math.max(maxY,object.position.y);
        }
        return {x:object.position.x,maxY};
      } finally { physics.dispose(); }
    };
    const shallow=await run(30);
    const steep=await run(60);
    expect(shallow.x).toBeGreaterThan(.8);
    expect(shallow.maxY).toBeGreaterThan(.7);
    expect(steep.x).toBeLessThan(-.6);
    expect(steep.maxY).toBeLessThan(.05);
  });

  it('keeps character movement pending until step so cancellation restores Rapier-compatible semantics',async()=>{
    const physics=createJoltPhysicsSystem(); await physics.init();
    const store=new ObjectStore();
    physics.addEnvironment([{shape:'box',halfExtents:[3,.1,2],translation:[0,-.1,0]}]);
    const object=attachAgent(physics,store,'agent',[0,0,0]);
    try {
      const before=physics.getPosition('agent');
      const result=physics.moveCharacter('agent',[.5,0,0]);
      expect(result.movement[0]).toBeGreaterThan(.45);
      expect(physics.getPosition('agent')).toEqual(before);
      const body=physics.entries.get('agent').body;
      expect(physics.backend.bodyPose(body,{next:true}).position[0]).toBeGreaterThan(.45);
      expect(physics.cancelCharacterMovement('agent')).toBe(true);
      physics.step(1/60,store);
      expect(object.position.x).toBeCloseTo(before[0],5);
    } finally { physics.dispose(); }
  });

  it('honors ignoreIds through native body filtering',async()=>{
    const physics=createJoltPhysicsSystem(); await physics.init();
    const store=new ObjectStore();
    physics.addEnvironment([{shape:'box',halfExtents:[3,.1,2],translation:[0,-.1,0]}]);
    const blockerObject=new THREE.Group(); blockerObject.position.set(0,.6,0); blockerObject.updateMatrixWorld(true);
    const blockerManifest={physics:{body:'fixed',colliders:[{shape:'box',halfExtents:[.2,.6,1]}]}};
    store.add('blocker',{id:'blocker',assetId:'blocker',object:blockerObject,manifest:blockerManifest,state:{}});
    physics.attach('blocker',blockerManifest,blockerObject);
    const object=attachAgent(physics,store,'agent',[-1,0,0]);
    try {
      const blocked=physics.moveCharacter('agent',[2,0,0]);
      expect(blocked.movement[0]).toBeLessThan(1);
      physics.setPosition('agent',[-1,0,0]);
      physics.step(1/60,store);
      const ignored=physics.moveCharacter('agent',[2,0,0],{ignoreIds:['blocker']});
      physics.step(1/60,store);
      expect(ignored.movement[0]).toBeGreaterThan(1.8);
      expect(object.position.x).toBeGreaterThan(.8);
    } finally { physics.dispose(); }
  });
});
