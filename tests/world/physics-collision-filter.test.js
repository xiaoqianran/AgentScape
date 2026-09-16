import { describe,expect,it } from 'vitest';
import * as THREE from 'three';
import { PhysicsSystem } from '../../modules/world/runtime/systems/PhysicsSystem.js';
import { RapierPhysicsBackend } from '../../modules/physics/RapierPhysicsBackend.js';
import { JoltPhysicsBackend } from '../../modules/physics/JoltPhysicsBackend.js';

const BACKENDS=[
  ['rapier',()=>new RapierPhysicsBackend({gravity:{x:0,y:0,z:0}})],
  ['jolt',()=>new JoltPhysicsBackend({gravity:{x:0,y:0,z:0}})]
];

const manifest=(id,body,collision,{sensor=false,collisionEvents=false}={})=>({
  id,type:'prop',source:{kind:'builtin'},actions:[],
  physics:{body,collision,sensor,collisionEvents,colliders:[{shape:'box',halfExtents:[.25,.25,.25]}]}
});

const runSteps=(physics,count=60)=>{ for(let i=0;i<count;i++) physics.backend.step(physics.world,1/60); };

describe.each(BACKENDS)('%s named collision filtering',(_name,createBackend)=>{
  it('compiles groups/collidesWith and supports runtime filter changes',async()=>{
    const physics=new PhysicsSystem({backend:createBackend()});
    await physics.init();
    try {
      const actor=new THREE.Object3D();
      const wall=new THREE.Object3D(); wall.position.x=1;
      physics.addObject('actor',manifest('actor','dynamic',{groups:['agent'],collidesWith:['environment']}),actor);
      physics.addObject('wall',manifest('wall','fixed',{groups:['environment'],collidesWith:['agent']}),wall);
      physics.setMotion('actor',{linearVelocity:[2,0,0],angularVelocity:[0,0,0]});
      runSteps(physics);
      expect(physics.getPosition('actor')[0]).toBeLessThan(.8);

      physics.setPosition('actor',[0,0,0]);
      physics.setMotion('actor',{linearVelocity:[2,0,0],angularVelocity:[0,0,0]});
      expect(physics.setCollisionFilter('wall',{groups:['environment'],collidesWith:[]})).toBe(true);
      runSteps(physics);
      expect(physics.getPosition('actor')[0]).toBeGreaterThan(1.2);
    } finally { physics.dispose(); }
  });

  it('keeps legacy undeclared bodies collision-compatible during migration',async()=>{
    const physics=new PhysicsSystem({backend:createBackend()});
    await physics.init();
    try {
      const actor=new THREE.Object3D();
      const legacyWall=new THREE.Object3D(); legacyWall.position.x=1;
      physics.addObject('actor',manifest('actor','dynamic',{groups:['agent'],collidesWith:['environment']}),actor);
      physics.addObject('legacy-wall',{id:'legacy-wall',type:'prop',source:{kind:'builtin'},actions:[],physics:{body:'fixed',colliders:[{shape:'box',halfExtents:[.25,.5,.5]}]}},legacyWall);
      physics.setMotion('actor',{linearVelocity:[2,0,0]});
      runSteps(physics);
      expect(physics.getPosition('actor')[0]).toBeLessThan(.8);
    } finally { physics.dispose(); }
  });

  it('filters sensor events with the same mutual rule',async()=>{
    const physics=new PhysicsSystem({backend:createBackend()});
    await physics.init();
    try {
      const trigger=new THREE.Object3D();
      const agent=new THREE.Object3D();
      physics.addObject('trigger',manifest('trigger','fixed',{groups:['trigger'],collidesWith:['agent']},{sensor:true,collisionEvents:true}),trigger);
      physics.addObject('agent',manifest('agent','dynamic',{groups:['agent'],collidesWith:['trigger']}),agent);
      physics.backend.step(physics.world,1/60);
      physics.updateCollisionEvents();
      expect(physics.getCollisionEvents().some((event)=>event.type==='sensor-entered')).toBe(true);

      physics.setCollisionFilter('agent',{groups:['agent'],collidesWith:[]});
      physics.backend.step(physics.world,1/60);
      physics.updateCollisionEvents();
      expect(physics.getCollisionEvents().some((event)=>event.type==='sensor-exited')).toBe(true);
    } finally { physics.dispose(); }
  });
});
