import { createRapierPhysicsSystem } from '../helpers/createRapierPhysicsSystem.js';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { ObjectStore } from '../../world/runtime/ObjectStore.js';
import { PhysicsSystem } from '../../world/runtime/systems/PhysicsSystem.js';

const manifest=(id)=>({id,type:'prop',source:{kind:'builtin'},actions:[],physics:{body:'fixed',colliders:[{shape:'box',halfExtents:[.25,.5,.5],translation:[0,.5,0]}]}});

describe('PhysicsSystem ray ownership filters',()=>{
  it('ignores only requested object ids and still hits the next physical target',async()=>{
    const physics=createRapierPhysicsSystem(); await physics.init();
    const store=new ObjectStore();
    for(const [id,x] of [['near',-1],['far',1]]){
      const object=new THREE.Group(); object.position.set(x,0,0); object.updateMatrixWorld(true);
      const m=manifest(id); store.add(id,{id,assetId:id,object,manifest:m,state:{}}); physics.attach(id,m,object);
    }
    physics.step(1/60,store);
    expect(physics.raycast([-3,.5,0],[3,.5,0])).toMatchObject({id:'near',environment:false});
    expect(physics.raycast([-3,.5,0],[3,.5,0],{excludeIds:['near']})).toMatchObject({id:'far',environment:false});
    physics.dispose();
  });
});
