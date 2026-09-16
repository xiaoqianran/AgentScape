export const DEFAULT_WAYPOINT_TOLERANCE = 0.18;

const finiteVec3 = (value) => Array.isArray(value) && value.length === 3 && value.every(Number.isFinite);
const round = (value) => Number(value.toFixed(4));
const roundVec3 = (value) => value.map(round);
const horizontalDistance = (a, b) => Math.hypot(a[0] - b[0], a[2] - b[2]);
const yawFromQuat = ([x, y, z, w]) => Math.atan2(2 * (w * y + x * z), 1 - 2 * (y * y + z * z));
const angleDelta = (from, to) => Math.atan2(Math.sin(to - from), Math.cos(to - from));
const remainingDistance = (task, current) => {
  let distance = horizontalDistance(current, task.path[task.step]);
  for (let i = task.step + 1; i < task.path.length; i += 1) distance += horizontalDistance(task.path[i - 1], task.path[i]);
  return distance;
};

export class LocomotionSystem {
  constructor({ store, physics, navigation, events = null } = {}) {
    this.store = store;
    this.physics = physics;
    this.navigation = navigation;
    this.events = events;
    this.tasks = new Map();
  }

  async navigate(id, target, { speed = 2.2, accel = 8, turn = 8, replans = 1, waypointTolerance = DEFAULT_WAYPOINT_TOLERANCE, stop = waypointTolerance, timeout = 45 } = {}) {
    if (!this.store?.has(id)) throw new Error(`Object not found: ${id}`);
    if (!finiteVec3(target)) throw new Error('navigate target requires finite [3]');
    if (!Number.isFinite(speed) || speed <= 0 || speed > 8) throw new Error('navigate speed must be within (0, 8]');
    if (!Number.isFinite(accel) || accel <= 0) throw new Error('navigate accel must be > 0');
    if (!Number.isFinite(turn) || turn <= 0) throw new Error('navigate turn must be > 0');
    if (!Number.isInteger(replans) || replans < 0 || replans > 3) throw new Error('navigate replans must be within [0, 3]');
    if (!Number.isFinite(waypointTolerance) || waypointTolerance <= 0) throw new Error('navigate waypointTolerance must be > 0');
    if (!Number.isFinite(stop) || stop <= 0) throw new Error('navigate stop must be > 0');
    if (!Number.isFinite(timeout) || timeout <= 0) throw new Error('navigate timeout must be > 0');
    if (this.tasks.has(id)) this.cancel(id, 'REPLACED');

    const record = this.store.get(id);
    if (record.manifest.type !== 'agent' || !record.manifest.actions?.includes('navigate')) throw new Error(`Object is not a navigable agent: ${id}`);
    if (record.manifest.physics?.body !== 'kinematic') throw new Error(`Navigable agent must use a kinematic body: ${id}`);
    const start = this.physics.getPosition(id);
    if (!start) throw new Error(`Physics body not available: ${id}`);

    const route = await this.navigation.findPath(start, target);
    if (!route.reachable) return { status:'unreachable', id, target:[...target], reason:route.reason || 'NO_PATH', route };

    const path = route.path;
    if (path.length <= 1 || horizontalDistance(start, target) <= stop) {
      record.state.navigation = { status:'arrived', target:[...target], speed };
      return { status:'arrived', id, target:[...target], position:roundVec3(start), route };
    }

    record.state.navigation = { status:'moving', target:[...target], speed, step:1, pathCost:route.cost };
    this.events?.emit('locomotion.started', { id, target:[...target], pathCost:route.cost, waypoints:path.length });

    return new Promise((resolve) => {
      this.tasks.set(id, {
        id, target:[...target], speed, accel, turn, replans, stop, waypointTolerance, timeout,
        path, route, step:1, v:0, time:0, stuck:0, vy:-0.5,
        grounded:null, hits:[], replanning:false, replanCount:0, replanWait:0,
        resolve
      });
    });
  }

  status(id) {
    if (this.tasks.has(id)) {
      const task = this.tasks.get(id);
      return {
        status:'moving', id, target:[...task.target], step:task.step,
        waypointCount:task.path.length, time:round(task.time), speed:task.speed, v:round(task.v),
        stuck:round(task.stuck), grounded:task.grounded, replanCount:task.replanCount,
        hits:structuredClone(task.hits)
      };
    }
    if (!this.store?.has(id)) return { status:'missing', id };
    return structuredClone(this.store.get(id).state?.navigation || { status:'idle' });
  }

  update(dt) {
    if (!Number.isFinite(dt) || dt <= 0) return;
    for (const task of [...this.tasks.values()]) this.updateTask(task, dt);
  }

  updateTask(task, dt) {
    task.time += dt;
    if (task.time > task.timeout) {
      this.finish(task, 'blocked', { reason:'LOCOMOTION_TIMEOUT' });
      return;
    }
    if (task.replanning) {
      task.replanWait += dt;
      if (task.replanWait > 0.5) this.finish(task, 'blocked', { reason:'PHYSICS_BLOCKED', hits:task.hits });
      return;
    }
    if (!this.store.has(task.id) || !this.physics.getPosition(task.id)) {
      this.finish(task, 'cancelled', { reason:'OBJECT_REMOVED' });
      return;
    }

    let current = this.physics.getPosition(task.id);
    this.advanceStep(task, current);

    if (task.step >= task.path.length) {
      this.finish(task, 'arrived', { position:current });
      return;
    }

    const remaining = remainingDistance(task, current);
    if (remaining <= task.stop) {
      this.finish(task, 'arrived', { position:current });
      return;
    }

    const point = task.path[task.step];
    const dx = point[0] - current[0];
    const dz = point[2] - current[2];
    const distance = Math.hypot(dx, dz);
    if (distance < 1e-8) {
      task.stuck += dt;
      if (task.stuck > 1.25) this.finish(task, 'blocked', { reason:'NO_HORIZONTAL_PROGRESS', position:current });
      return;
    }

    const brakeSpeed = Math.sqrt(2 * task.accel * Math.max(0, remaining - task.stop));
    const targetSpeed = Math.min(task.speed, brakeSpeed);
    const delta = task.accel * dt;
    task.v = targetSpeed > task.v ? Math.min(targetSpeed, task.v + delta) : Math.max(targetSpeed, task.v - delta);
    const horizontalStep = Math.min(distance, task.v * dt);
    const carried = this.store.list().filter(([,record]) => record.state?.heldBy?.kind === 'agent' && record.state.heldBy.id === task.id);
    this.steer(task, dx, dz, dt, carried.length > 0);
    task.vy = Math.max(-8, task.vy - 9.81 * dt);
    const desired = [dx / distance * horizontalStep, task.vy * dt, dz / distance * horizontalStep];
    const movement = this.applyMove(task, desired, current, carried);
    if (!movement) return;
    if (movement.grounded) task.vy = -0.5;

    const movedHorizontally = Math.hypot(movement.movement[0], movement.movement[2]);
    const predicted = [current[0] + movement.movement[0], current[1] + movement.movement[1], current[2] + movement.movement[2]];
    const progress = distance - horizontalDistance(predicted, point);
    if (movedHorizontally < horizontalStep * 0.12 || progress < 0.001) task.stuck += dt;
    else task.stuck = 0;

    if (task.stuck > 1.25) {
      if (task.replanCount < task.replans) this.replan(task, current);
      else this.finish(task, 'blocked', { reason:'PHYSICS_BLOCKED', position:current, hits:task.hits });
    }
  }

  advanceStep(task, current) {
    while (task.step < task.path.length) {
      const point = task.path[task.step];
      const tolerance = task.step === task.path.length - 1 ? task.stop : task.waypointTolerance;
      if (horizontalDistance(current, point) > tolerance || Math.abs(current[1] - point[1]) > 0.42) break;
      task.step += 1;
      const record = this.store.get(task.id);
      if (record.state.navigation) record.state.navigation.step = task.step;
    }
  }

  steer(task, dx, dz, dt, carrying) {
    if (carrying) {
      this.physics.faceCharacter(task.id, [dx, 0, dz]);
      return;
    }
    const rotation = this.physics.getRotation(task.id);
    if (!rotation) return;
    const yaw = yawFromQuat(rotation);
    const targetYaw = Math.atan2(-dx, -dz);
    const turn = Math.max(-task.turn * dt, Math.min(task.turn * dt, angleDelta(yaw, targetYaw)));
    const nextYaw = yaw + turn;
    this.physics.faceCharacter(task.id, [-Math.sin(nextYaw), 0, -Math.cos(nextYaw)]);
  }

  applyMove(task, desired, current, carried) {
    const movement = this.physics.moveCharacter(task.id, desired, { ignoreIds:carried.map(([id]) => id) });
    if (!movement.success) {
      this.finish(task, 'blocked', { reason:movement.code, position:current });
      return null;
    }
    task.grounded = movement.grounded === true;
    task.hits = (movement.collisions || []).slice(0, 4);
    for (const [carriedId] of carried) {
      const anchor = this.store.get(task.id).manifest.embodiment?.holdAnchor;
      const pose = this.physics.anchorPose(task.id, anchor, { next:true });
      const clearance = pose && this.physics.checkBodyMotion(carriedId, pose.position, pose.rotation, { excludeIds:[task.id] });
      if (!pose || !clearance?.clear) {
        this.finish(task, 'blocked', { reason:'CARRIED_OBJECT_BLOCKED', position:current, carry:{id:carriedId, clearance:clearance || null} });
        return null;
      }
      this.physics.setHeldTarget(carriedId, pose.position, pose.rotation);
    }
    return movement;
  }

  async replan(task, current) {
    if (!this.tasks.has(task.id) || task.replanning || task.replanCount >= task.replans) return false;
    task.replanning = true;
    task.replanCount += 1;
    task.replanWait = 0;
    this.physics.cancelCharacterMovement?.(task.id);
    try {
      const route = await this.navigation.findPath(current, task.target);
      if (!this.tasks.has(task.id)) return false;
      if (!route.reachable || !Array.isArray(route.path) || route.path.length <= 1) {
        this.finish(task, 'blocked', {
          reason:route.reason || 'REPLAN_FAILED',
          position:current,
          hits:task.hits
        });
        return false;
      }
      task.route = route;
      task.path = route.path;
      task.step = 1;
      task.v = 0;
      task.stuck = 0;
      task.replanWait = 0;
      task.hits = [];
      const record = this.store.get(task.id);
      if (record.state.navigation) {
        record.state.navigation.step = 1;
        record.state.navigation.pathCost = route.cost;
      }
      this.events?.emit('locomotion.replanned', { id:task.id, target:[...task.target], count:task.replanCount, pathCost:route.cost, waypoints:route.path.length });
      return true;
    } catch (error) {
      if (this.tasks.has(task.id)) this.finish(task, 'blocked', { reason:'REPLAN_FAILED', position:current, hits:task.hits });
      return false;
    } finally {
      task.replanning = false;
    }
  }

  finish(task, status, details = {}) {
    if (!this.tasks.has(task.id)) return;
    this.physics.cancelCharacterMovement?.(task.id);
    this.tasks.delete(task.id);
    const position = this.physics.getPosition(task.id) || details.position || null;
    if (this.store.has(task.id)) {
      const record = this.store.get(task.id);
      record.state.navigation = {
        status, target:[...task.target], speed:task.speed,
        ...(details.reason ? { reason:details.reason } : {})
      };
    }
    const result = {
      status, id:task.id, target:[...task.target],
      position:position ? roundVec3(position) : null,
      time:round(task.time),
      pathCost:task.route.cost,
      waypointCount:task.path.length,
      ...(details.reason ? { reason:details.reason } : {}),
      ...(details.hits ? { hits:details.hits } : {}),
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