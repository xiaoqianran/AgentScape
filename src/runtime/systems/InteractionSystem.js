import * as THREE from 'three';
import { Errors } from '../../core/errors.js';

export class InteractionSystem {
  constructor({ store, physics, spatial, events }) {
    this.store = store;
    this.physics = physics;
    this.spatial = spatial;
    this.events = events;
    this.heldId = null;
  }

  supports(record, action) { return record.manifest.actions.includes(action); }

  assertSupports(id, action) {
    const record = this.store.get(id);
    if (!this.supports(record, action)) throw Errors.actionUnsupported(id, action);
    return record;
  }

  move(id, position) {
    const record = this.assertSupports(id, 'move');
    record.object.position.fromArray(position);
    this.physics.setPosition(id, position);
    this.events.emit('interaction', { action: 'move', id, position });
  }

  pickup(id) {
    this.assertSupports(id, 'pickup');
    if (this.heldId && this.heldId !== id) this.drop(this.heldId);
    this.heldId = id;
    this.physics.setHeld(id, true);
    this.events.emit('interaction', { action: 'pickup', id });
  }

  drop(id = this.heldId) {
    if (!id) return;
    this.assertSupports(id, 'drop');
    this.physics.setHeld(id, false);
    if (this.heldId === id) this.heldId = null;
    this.events.emit('interaction', { action: 'drop', id });
  }

  place(id, targetId, options = {}) {
    this.assertSupports(id, 'place');
    const target = this.store.get(targetId);
    if (!target.manifest.surfaces?.length) throw Errors.actionUnsupported(targetId, 'receive');
    const p = this.spatial.findFreeSpace(id, targetId, options);
    if (!p) throw new Error(`No collision-free placement found on ${targetId}`);
    this.pickup(id);
    this.store.get(id).object.position.copy(p);
    this.physics.setPosition(id, p.toArray());
    this.drop(id);
    this.events.emit('interaction', { action: 'place', id, targetId, position: p.toArray() });
    return { id, targetId, position: p.toArray().map((v) => Number(v.toFixed(3))) };
  }

  findPartForAction(record, action, partName = null) {
    const parts = Object.entries(record.manifest.parts || {}).filter(([name, part]) =>
      (!partName || name === partName) && part.actions?.includes(action) && Number.isFinite(part.targets?.[action])
    );
    if (parts.length !== 1) throw Errors.actionUnsupported(record.id, partName ? `${action}:${partName}` : action);
    return parts[0];
  }

  setArticulationAction(id, action, { partName = null } = {}) {
    const record = this.assertSupports(id, action);
    const [name, part] = this.findPartForAction(record, action, partName);
    if (!this.physics.setArticulationTarget(id, name, part.targets[action])) throw Errors.actionUnsupported(id, action);
    record.state.parts ||= {};
    record.state.parts[name] = action;
    this.events.emit('interaction', { action, id, part: name, target: part.targets[action] });
    return { id, part: name, action, target: part.targets[action] };
  }

  update(_dt, camera) {
    if (!this.heldId) return;
    const target = new THREE.Vector3(0, 0, -1.6).applyQuaternion(camera.quaternion).add(camera.position);
    this.physics.setHeldTarget(this.heldId, target);
  }
}
