import { createRapierPhysicsSystem } from '../helpers/createRapierPhysicsSystem.js';
import * as THREE from 'three';
import { expect, it } from 'vitest';

it('observes articulation penetration immediately after attach even when joint contacts are disabled',async()=>{
  const manifest={physics:{body:'fixed',colliders:[{shape:'box',halfExtents:[.5,.5,.5]}]},parts:{part:{node:'Part',physics:{body:'dynamic',colliders:[{shape:'box',halfExtents:[.1,.1,.1]}]},joint:{type:'prismatic',axis:[1,0,0],limits:[0,.5],parentAnchor:[0,0,0],childAnchor:[0,0,0]}}}};
  const root=new THREE.Group(); const part=new THREE.Group(); part.name='Part'; root.add(part); root.updateMatrixWorld(true);
  const physics=createRapierPhysicsSystem(); await physics.init(); const entry=physics.attach('x',manifest,root);
  expect(entry.parts.get('part').joint.contactsEnabled()).toBe(false);
  const hits=physics.articulationPenetrations('x','part',{refresh:true});
  expect(hits).toHaveLength(1);
  expect(hits[0].targetPart).toBe('$root');
  expect(hits[0].depth).toBeGreaterThan(.1);
  physics.dispose();
});
