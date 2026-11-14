import { it, expect } from 'vitest';
import { samePhysicalGeometry } from '../../modules/world/runtime/WorldCollisionSignature.js';

it('reuses collision placement only for identical root and part geometry',()=>{
  const original={
    physics:{body:'fixed',mass:1,colliders:[{shape:'box',halfExtents:[.1,1,.1]}]},
    parts:{door:{physics:{body:'dynamic',mass:5,colliders:[{shape:'box',halfExtents:[.6,1,.03]}]},
      joint:{type:'revolute',axis:[0,1,0],limits:[0,1.57]}}}
  };
  const visual=structuredClone(original);
  visual.physics.mass=2;
  visual.parts.door.physics.mass=7;
  visual.label='New material';
  expect(samePhysicalGeometry(original,visual)).toBe(true);
  visual.parts.door.physics.colliders[0].halfExtents[0]=.7;
  expect(samePhysicalGeometry(original,visual)).toBe(false);
  const joint=structuredClone(original);
  joint.parts.door.joint.limits[1]=2;
  expect(samePhysicalGeometry(original,joint)).toBe(false);
  const root=structuredClone(original);
  root.physics.colliders[0].halfExtents[0]=.2;
  expect(samePhysicalGeometry(original,root)).toBe(false);
});
