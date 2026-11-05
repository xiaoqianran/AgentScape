import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { PhysicsSystem } from '../../modules/world/runtime/systems/PhysicsSystem.js';
import { RapierPhysicsBackend } from '../../modules/physics/RapierPhysicsBackend.js';
import { JoltPhysicsBackend } from '../../modules/physics/JoltPhysicsBackend.js';

for (const Backend of [RapierPhysicsBackend, JoltPhysicsBackend]) {
  describe(Backend.name + ' portable rollback checkpoint', () => {
    it('restores dynamic motion, sleeping state and kinematic targets after body recreation', async () => {
      const physics = new PhysicsSystem({ backend:new Backend() });
      await physics.init();
      const definitions = [
        ['moving', 'dynamic', [0,5,0]], ['sleeping', 'dynamic', [3,5,0]], ['actor', 'kinematic', [6,5,0]]
      ].map(([id,type,position]) => {
        const object = new THREE.Group(); object.position.fromArray(position);
        return { id, object, manifest:{ physics:{ body:type, mass:1, colliders:[{shape:'box',halfExtents:[.2,.2,.2]}] } } };
      });
      const add = () => definitions.forEach(({id,object,manifest}) => physics.addObject(id,manifest,object));
      try {
        add();
        physics.setMotion('moving', { linearVelocity:[1,2,3], angularVelocity:[0,2,0] });
        physics.sleep('sleeping');
        physics.setHeldTarget('actor', [7,5,0]);
        const before = physics.captureState();
        physics.resetWorld(); add();
        physics.restoreState(before);
        expect(physics.getMotion('moving').linearVelocity).toEqual([1,2,3]);
        expect(physics.getMotion('moving').angularVelocity).toEqual([0,2,0]);
        expect(physics.getMotion('sleeping').sleeping).toBe(true);
        expect(physics.backend.bodyPose(physics.entries.get('actor').body,{next:true}).position).toEqual([7,5,0]);
        expect(definitions[0].object.position.toArray()).toEqual([0,5,0]);
      } finally { physics.dispose(); }
    });

    it('restores both an inactive motor and a previously active joint target', async () => {
      const physics = new PhysicsSystem({ backend:new Backend() });
      await physics.init();
      const root = new THREE.Group();
      const door = new THREE.Group(); door.name='door'; door.position.set(0,1,0); root.add(door);
      const manifest = {
        physics:{ body:'fixed', colliders:[{shape:'box',halfExtents:[.1,.1,.1]}] },
        parts:{ door:{ node:'door', physics:{ body:'dynamic', mass:1, colliders:[{shape:'box',halfExtents:[.2,.2,.2]}] },
          joint:{ type:'revolute', axis:[0,1,0], limits:[-1.5,1.5], parentAnchor:[0,1,0], childAnchor:[0,0,0], motor:{stiffness:40,damping:8} } } }
      };
      try {
        physics.addObject('cabinet',manifest,root);
        const inactive = physics.captureState();
        physics.setArticulationTarget('cabinet','door',1);
        const setTarget = vi.spyOn(physics.backend,'setJointTarget');
        physics.restoreState(inactive);
        expect(setTarget).toHaveBeenLastCalledWith(expect.anything(),null,manifest.parts.door.joint.motor);
        expect(physics.entries.get('cabinet').parts.get('door').motorTarget).toBeNull();
        physics.setArticulationTarget('cabinet','door',.5);
        const active = physics.captureState();
        physics.setArticulationTarget('cabinet','door',1);
        physics.restoreState(active);
        expect(setTarget).toHaveBeenLastCalledWith(expect.anything(),.5,manifest.parts.door.joint.motor);
        expect(door.position.toArray()).toEqual(active[0].parts[0].position);
      } finally { physics.dispose(); }
    });
  });
}
