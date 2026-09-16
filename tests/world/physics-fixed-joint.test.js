import { describe,it,expect } from 'vitest';
import * as THREE from 'three';
import { createRapierPhysicsSystem } from '../helpers/createRapierPhysicsSystem.js';
import { createJoltPhysicsSystem } from '../helpers/createJoltPhysicsSystem.js';

const factories=[['rapier',createRapierPhysicsSystem],['jolt',createJoltPhysicsSystem]];

describe.each(factories)('%s fixed-joint system semantics',(_name,createPhysics)=>{
  it('treats fixed joints as structural, not driveable articulation',async()=>{
    const physics=createPhysics(); await physics.init();
    try {
      const root=new THREE.Group(); const part=new THREE.Group(); part.name='FixedPart'; part.position.set(1,0,0); root.add(part); root.updateMatrixWorld(true);
      const manifest={id:'fixed-assembly',type:'prop',source:{kind:'builtin'},actions:[],physics:{body:'fixed',colliders:[]},parts:{fixed:{node:'FixedPart',physics:{body:'dynamic',mass:1,colliders:[{shape:'box',halfExtents:[.2,.2,.2]}]},joint:{type:'fixed',parentAnchor:[1,0,0],childAnchor:[0,0,0]}}}};
      physics.addObject('assembly',manifest,root);
      expect(physics.getArticulationState('assembly','fixed')).toBeNull();
      expect(physics.setArticulationTarget('assembly','fixed',1)).toBe(false);
      expect(physics.holdArticulationCurrent('assembly','fixed')).toBe(false);
    } finally { physics.dispose(); }
  });
});
