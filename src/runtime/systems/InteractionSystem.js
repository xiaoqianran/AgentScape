import * as THREE from 'three';
import { Errors } from '../../core/errors.js';

export class InteractionSystem {
  constructor({ store, physics, events }) { this.store = store; this.physics = physics; this.events = events; this.heldId = null; }
  supports(record, action) { return record.manifest.actions.includes(action); }
  assertSupports(id, action) { const r = this.store.get(id); if (!this.supports(r, action)) throw Errors.actionUnsupported(id, action); return r; }
  move(id, position) { const r = this.assertSupports(id, 'move'); r.object.position.fromArray(position); this.physics.setPosition(id, position); this.events.emit('interaction', { action: 'move', id, position }); }
  pickup(id) { this.assertSupports(id, 'pickup'); if (this.heldId && this.heldId !== id) this.drop(this.heldId); this.heldId = id; this.physics.setHeld(id, true); this.events.emit('interaction', { action: 'pickup', id }); }
  drop(id = this.heldId) { if (!id) return; this.assertSupports(id, 'drop'); this.physics.setHeld(id, false); if (this.heldId === id) this.heldId = null; this.events.emit('interaction', { action: 'drop', id }); }
  place(id, targetId) { this.assertSupports(id, 'place'); const target = this.store.get(targetId); const surface = target.manifest.surfaces?.[0]; if (!surface) throw Errors.actionUnsupported(targetId, 'receive'); const p = new THREE.Vector3(...surface.localPosition).add(target.object.position); this.pickup(id); this.store.get(id).object.position.copy(p); this.physics.setPosition(id, p.toArray()); this.drop(id); this.events.emit('interaction', { action: 'place', id, targetId }); }
  setDoor(id, open) { const r = this.assertSupports(id, open ? 'open' : 'close'); const part = r.manifest.parts?.door; const node = r.object.getObjectByName(part?.node); if (!part || !node) throw Errors.actionUnsupported(id, 'door'); r.state.doorTarget = open ? part.joint.limits[0] : part.joint.limits[1]; this.events.emit('interaction', { action: open ? 'open' : 'close', id }); }
  update(dt, camera) {
    if (this.heldId) { const target = new THREE.Vector3(0, 0, -1.6).applyQuaternion(camera.quaternion).add(camera.position); this.physics.setHeldTarget(this.heldId, target); }
    for (const [, r] of this.store.entries()) {
      if (r.state.doorTarget == null) continue;
      const node = r.object.getObjectByName(r.manifest.parts?.door?.node); if (node) node.rotation.y = THREE.MathUtils.lerp(node.rotation.y, r.state.doorTarget, Math.min(1, dt * 6));
    }
  }
}
