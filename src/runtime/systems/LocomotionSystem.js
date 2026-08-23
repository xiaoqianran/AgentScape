const finiteVec3 = (value) => Array.isArray(value) && value.length === 3 && value.every(Number.isFinite);
const round = (value) => Number(value.toFixed(4));
const roundVec3 = (value) => value.map(round);
const horizontalDistance = (a, b) => Math.hypot(a[0] - b[0], a[2] - b[2]);

export class LocomotionSystem {
  constructor({ store, physics, navigation, events = null } = {}) {
    this.store = store;
    this.physics = physics;
    this.navigation = navigation;
    this.events = events;
    this.tasks = new Map();
  }

  async navigate(id, end, { speed = 2.2, waypointTolerance = 0.18, timeout = 45 } = {}) {
    if (!this.store?.has(id)) throw new Error(`Object not found: ${id}`);
    if (!finiteVec3(end)) throw new Error('navigate end requires finite [3]');
    if (!Number.isFinite(speed) || speed <= 0 || speed > 8) throw new Error('navigate speed must be within (0, 8]');
    if (this.tasks.has(id)) throw new Error(`Locomotion already active: ${id}`);

    const record = this.store.get(id);
    if (record.manifest.type !== 'agent' || !record.manifest.actions?.includes('navigate')) throw new Error(`Object is not a navigable agent: ${id}`);
    if (record.manifest.physics?.body !== 'kinematic') throw new Error(`Navigable agent must use a kinematic body: ${id}`);
    const start = this.physics.getPosition(id);
    if (!start) throw new Error(`Physics body not available: ${id}`);

    const route = await this.navigation.findPath(start, end);
    if (!route.reachable) return { status:'unreachable', id, target:[...end], route };

    const path = route.path;
    if (path.length <= 1 || horizontalDistance(start, end) <= waypointTolerance) {
      record.state.navigation = { status:'arrived', target:[...end], speed };
      return { status:'arrived', id, target:[...end], position:roundVec3(start), route };
    }

    record.state.navigation = { status:'moving', target:[...end], speed, waypoint:1, pathCost:route.cost };
    this.events?.emit('locomotion.started', { id, target:[...end], pathCost:route.cost, waypoints:path.length });

    return new Promise((resolve) => {
      this.tasks.set(id, {
        id, end:[...end], speed, waypointTolerance, timeout,
        path, route, waypoint:1, elapsed:0, noProgress:0, verticalVelocity:-0.5,
        resolve
      });
    });
  }

  status(id) {
    if (this.tasks.has(id)) {
      const task = this.tasks.get(id);
      return {
        status:'moving', id, target:[...task.end], waypoint:task.waypoint,
        waypointCount:task.path.length, elapsed:round(task.elapsed), speed:task.speed
      };
    }
    if (!this.store?.has(id)) return { status:'missing', id };
    return structuredClone(this.store.get(id).state?.navigation || { status:'idle' });
  }

  update(dt) {
    for (const task of [...this.tasks.values()]) this.updateTask(task, dt);
  }

  updateTask(task, dt) {
    if (!this.store.has(task.id) || !this.physics.getPosition(task.id)) {
      this.finish(task, 'cancelled', { reason:'OBJECT_REMOVED' });
      return;
    }

    task.elapsed += dt;
    if (task.elapsed > task.timeout) {
      this.finish(task, 'blocked', { reason:'LOCOMOTION_TIMEOUT' });
      return;
    }

    let current = this.physics.getPosition(task.id);
    while (task.waypoint < task.path.length) {
      const waypoint = task.path[task.waypoint];
      if (horizontalDistance(current, waypoint) > task.waypointTolerance || Math.abs(current[1] - waypoint[1]) > 0.42) break;
      task.waypoint += 1;
      const record = this.store.get(task.id);
      if (record.state.navigation) record.state.navigation.waypoint = task.waypoint;
    }

    if (task.waypoint >= task.path.length) {
      this.finish(task, 'arrived', { position:current });
      return;
    }

    const waypoint = task.path[task.waypoint];
    const dx = waypoint[0] - current[0];
    const dz = waypoint[2] - current[2];
    const distance = Math.hypot(dx, dz);
    if (distance < 1e-8) {
      task.noProgress += dt;
      if (task.noProgress > 1.25) this.finish(task, 'blocked', { reason:'NO_HORIZONTAL_PROGRESS', position:current });
      return;
    }

    const horizontalStep = Math.min(distance, task.speed * dt);
    this.physics.faceCharacter(task.id, [dx, 0, dz]);
    task.verticalVelocity = Math.max(-8, task.verticalVelocity - 9.81 * dt);
    const desired = [dx / distance * horizontalStep, task.verticalVelocity * dt, dz / distance * horizontalStep];
    const carried = this.store.list().filter(([,record]) => record.state?.heldBy?.kind === 'agent' && record.state.heldBy.id === task.id);
    const movement = this.physics.moveCharacter(task.id, desired, { ignoreIds:carried.map(([id]) => id) });
    if (!movement.success) {
      this.finish(task, 'blocked', { reason:movement.code, position:current });
      return;
    }
    for (const [carriedId] of carried) {
      const anchor = this.store.get(task.id).manifest.embodiment?.holdAnchor;
      const pose = this.physics.anchorPose(task.id, anchor, { next:true });
      const clearance = pose && this.physics.bodyMotionClear(carriedId, pose.position, pose.rotation, { excludeIds:[task.id] });
      if (!pose || !clearance?.clear) {
        this.physics.cancelCharacterMovement(task.id);
        this.finish(task, 'blocked', { reason:'CARRIED_OBJECT_BLOCKED', position:current, carry:{id:carriedId, clearance:clearance || null} });
        return;
      }
      this.physics.setHeldTarget(carriedId, pose.position, pose.rotation);
    }
    if (movement.grounded) task.verticalVelocity = -0.5;

    const movedHorizontally = Math.hypot(movement.movement[0], movement.movement[2]);
    const predicted = [current[0] + movement.movement[0], current[1] + movement.movement[1], current[2] + movement.movement[2]];
    const progress = distance - horizontalDistance(predicted, waypoint);
    if (movedHorizontally < horizontalStep * 0.12 || progress < 0.001) task.noProgress += dt;
    else task.noProgress = 0;

    if (task.noProgress > 1.25) {
      this.finish(task, 'blocked', {
        reason:'PHYSICS_BLOCKED', position:current,
        collisions:movement.collisions.slice(0, 4)
      });
    }
  }

  finish(task, status, details = {}) {
    if (!this.tasks.has(task.id)) return;
    this.tasks.delete(task.id);
    const position = this.physics.getPosition(task.id) || details.position || null;
    if (this.store.has(task.id)) {
      const record = this.store.get(task.id);
      record.state.navigation = {
        status, target:[...task.end], speed:task.speed,
        ...(details.reason ? { reason:details.reason } : {})
      };
    }
    const result = {
      status, id:task.id, target:[...task.end],
      position:position ? roundVec3(position) : null,
      elapsed:round(task.elapsed),
      pathCost:task.route.cost,
      waypointCount:task.path.length,
      ...(details.reason ? { reason:details.reason } : {}),
      ...(details.collisions ? { collisions:details.collisions } : {}),
      ...(details.carry ? { carry:details.carry } : {})
    };
    this.events?.emit(`locomotion.${status}`, result);
    task.resolve(result);
  }

  cancel(id, reason = 'CANCELLED') {
    const task = this.tasks.get(id);
    if (!task) return false;
    this.finish(task, 'cancelled', { reason });
    return true;
  }

  cancelAll(reason = 'RUNTIME_DISPOSED') {
    for (const id of [...this.tasks.keys()]) this.cancel(id, reason);
  }
}
