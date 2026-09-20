import { assetAdmission } from '../../asset/model/admission.js';

const round3 = (value) => Number(value.toFixed(3));
const vec3Round = (value) => Array.isArray(value) ? value.map(round3) : value;
const yawFromQuat = ([x, y, z, w]) => Math.atan2(2 * (w * y + x * z), 1 - 2 * (y * y + z * z));

export class WorldCommands {
  constructor(runtime) {
    if (!runtime) throw new TypeError('WorldCommands requires a WorldRuntime');
    this.runtime = runtime;
  }

  assertReady(command) {
    if (this.runtime.ready !== false) return;
    const assembled = this.runtime.sceneGraph
      && this.runtime.history
      && this.runtime.navigation
      && this.runtime.locomotion
      && this.runtime.interactions;
    if (assembled) return;
    const error = new Error(`World command requires an initialized WorldRuntime: ${command}`);
    error.code = 'WORLD_COMMAND_NOT_READY';
    error.command = command;
    throw error;
  }

  async spawn(assetId, options = {}) {
    this.assertReady('spawn');
    const admission = assetAdmission(this.runtime.assetModule.getManifest(assetId));
    if (admission.status === 'rejected') {
      return { status:'asset-rejected', assetId, admission };
    }
    const id = await this.runtime.spawn(assetId, options);
    return admission.status === 'ready'
      ? id
      : { status:'asset-provisional', id, assetId, admission };
  }

  transform(id, transform = {}, options = {}) {
    this.assertReady('transform');
    return this.runtime.applyObjectTransform(id, transform, options);
  }

  beginTransform(id) {
    this.assertReady('beginTransform');
    return this.runtime.physics.beginTransform(id);
  }

  endTransform(id) {
    this.assertReady('endTransform');
    return this.runtime.physics.endTransform(id);
  }

  setHumanViewPose(pose) {
    this.assertReady('setHumanViewPose');
    return this.runtime.interactions.setHumanViewPose(pose);
  }

  async duplicate(id) {
    this.assertReady('duplicate');
    const source = this.runtime.store.get(id);
    const assetId = source.assetId;
    const admission = assetAdmission(this.runtime.assetModule.getManifest(assetId));
    if (admission.status === 'rejected') {
      return { status:'asset-rejected', assetId, sourceId:id, admission };
    }
    const duplicateId = await this.runtime.duplicate(id);
    return admission.status === 'ready'
      ? duplicateId
      : { status:'asset-provisional', id:duplicateId, assetId, sourceId:id, admission };
  }

  remove(id, options = {}) {
    this.assertReady('remove');
    return this.runtime.remove(id, options);
  }

  navigate(id, end, options = {}) {
    this.assertReady('navigate');
    return this.runtime.locomotion.navigate(id, end, options);
  }

  async moveForward(id, { distance = 0.8, speed } = {}) {
    this.assertReady('moveForward');
    if (!this.runtime.store?.has?.(id)) {
      const error = new Error(`Object not found: ${id}`);
      error.code = 'OBJECT_NOT_FOUND';
      throw error;
    }
    if (!Number.isFinite(distance) || distance <= 0 || distance > 4) {
      const error = new Error('moveForward distance must be within (0, 4]');
      error.code = 'MOVE_FORWARD_DISTANCE_INVALID';
      throw error;
    }
    const record = this.runtime.store.get(id);
    if (record.manifest?.type !== 'agent' || !record.manifest.actions?.includes('navigate')) {
      const error = new Error(`Object is not a navigable agent: ${id}`);
      error.code = 'NOT_NAVIGABLE_AGENT';
      throw error;
    }
    if (record.manifest.physics?.body !== 'kinematic') {
      const error = new Error(`Navigable agent must use a kinematic body: ${id}`);
      error.code = 'NAVIGABLE_BODY_INVALID';
      throw error;
    }
    const start = this.runtime.physics?.getPosition?.(id);
    if (!start) {
      const error = new Error(`Physics body not available: ${id}`);
      error.code = 'PHYSICS_BODY_UNAVAILABLE';
      throw error;
    }
    const rotation = this.runtime.physics?.getRotation?.(id);
    if (!Array.isArray(rotation) || rotation.length !== 4 || !rotation.every(Number.isFinite)) {
      const error = new Error(`Agent rotation unavailable: ${id}`);
      error.code = 'AGENT_ROTATION_UNAVAILABLE';
      throw error;
    }
    const yaw = yawFromQuat(rotation);
    // 与 LocomotionSystem.steer 的 character facing 一致：[-sin(yaw), 0, -cos(yaw)]
    const forward = [-Math.sin(yaw), 0, -Math.cos(yaw)];
    const end = [
      start[0] + forward[0] * distance,
      start[1],
      start[2] + forward[2] * distance
    ];
    const result = await this.runtime.locomotion.navigate(id, end, { speed });
    const position = Array.isArray(result?.position) ? result.position : null;
    const moved = position
      ? Math.hypot(position[0] - start[0], position[2] - start[2])
      : (result?.status === 'arrived' ? distance : 0);
    const base = {
      ...result,
      skill: 'moveForward',
      start: vec3Round(start),
      end: vec3Round(end),
      distance,
      yaw: round3(yaw),
      forward: vec3Round(forward),
      moved: round3(moved)
    };
    if (result?.status === 'arrived' && moved < Math.max(0.05, distance * 0.35)) {
      return {
        ...base,
        status: 'blocked',
        reason: 'INSUFFICIENT_FORWARD_DISPLACEMENT'
      };
    }
    return base;
  }

  activateEnvironmentInteraction(interactionId, { actorId = null, requireReach = true } = {}) {
    this.assertReady('activateEnvironmentInteraction');
    const runtime = this.runtime;
    const interactions = runtime.environment?.interactions || [];
    const item = interactions.find((entry) => entry.id === interactionId);
    if (!item) {
      return { status:'interaction-not-found', interactionId, environmentId:runtime.environment?.id || null };
    }
    if (typeof item.activate !== 'function') {
      return { status:'interaction-not-executable', interactionId, label:item.label || null };
    }

    const position = (() => {
      const object = item.object;
      if (!object) return null;
      if (object.isObject3D) {
        object.updateWorldMatrix?.(true, false);
        const elements = object.matrixWorld?.elements;
        if (elements) return [elements[12], elements[13], elements[14]];
      }
      return null;
    })();

    if (requireReach && actorId) {
      const feet = runtime.physics?.getPosition?.(actorId);
      if (!feet) {
        return { status:'world-action-blocked', interactionId, reason:'ACTOR_PHYSICS_UNAVAILABLE', actorId };
      }
      if (!position) {
        return { status:'world-action-blocked', interactionId, reason:'INTERACTION_POSITION_UNAVAILABLE', actorId };
      }
      const distance = Math.hypot(position[0]-feet[0], position[1]-feet[1], position[2]-feet[2]);
      if (distance > 1.5) {
        return {
          status:'world-action-blocked', interactionId, reason:'OUT_OF_REACH',
          actorId, distance:round3(distance), maxDistance:1.5, position:vec3Round(position)
        };
      }
      if (runtime.physics?.hasCapability?.('scene-query') && runtime.physics.raycast) {
        const origin = [feet[0], feet[1] + 1.2, feet[2]];
        const hit = runtime.physics.raycast(origin, position, { excludeId: actorId });
        if (hit && hit.distance < distance - 0.12) {
          return {
            status:'world-action-blocked', interactionId, reason:'OCCLUDED',
            actorId, blocker:hit.provenance || { id:hit.id }, distance:round3(distance)
          };
        }
      }
    }

    // 有 formal contract 的原生物件：走 WorldAffordances 验证路径
    if (item.contractId) {
      const contract = runtime.affordances?.get?.(item.contractId);
      if (contract) {
        const state = contract.read?.() || {};
        let action = null;
        if (contract.kind === 'book') action = state.out ? 'return' : 'pull_out';
        else if (contract.kind === 'switch') action = state.on ? 'turn_off' : 'turn_on';
        else if (state.requestedOpen === true || state.out === true) action = 'close';
        else if (state.requestedOpen === false || state.out === false) action = contract.kind === 'book' ? 'pull_out' : 'open';
        if (action && contract.actions?.includes(action)) {
          return runtime.affordances.execute({ targetId:item.contractId, action, actorId }, {});
        }
        item.activate();
        return {
          status:'environment-interaction-activated',
          interactionId, label:item.label || null,
          contractId:item.contractId,
          via:'native-activate',
          provisional:false,
          verification:'runtime-contract'
        };
      }
    }

    item.activate();
    return {
      status:'environment-interaction-activated',
      interactionId,
      label:item.label || null,
      contractId:item.contractId || null,
      environmentId:runtime.environment?.id || null,
      position:vec3Round(position),
      via:'native-activate',
      provisional:true,
      verification:'native-provisional',
      evidenceKind:'animated-transform',
      physicsVerified:false,
      note:'Native Three.js scene interaction; not force-verified articulated asset physics.'
    };
  }

  pickup(id) {
    this.assertReady('pickup');
    return this.runtime.interactions.pickup(id);
  }

  drop(id) {
    this.assertReady('drop');
    return this.runtime.interactions.drop(id);
  }

  place(id, targetId, options = {}) {
    this.assertReady('place');
    return this.runtime.interactions.place(id, targetId, options);
  }

  setArticulationAction(id, action, options = {}) {
    this.assertReady('setArticulationAction');
    return this.runtime.interactions.setArticulationAction(id, action, options);
  }

  approachAndInteract(actorId, targetId, action, options = {}) {
    this.assertReady('approachAndInteract');
    return this.runtime.interactions.approachAndInteract(actorId, targetId, action, options);
  }

  approachAndPickup(actorId, targetId, options = {}) {
    this.assertReady('approachAndPickup');
    return this.runtime.interactions.approachAndPickup(actorId, targetId, options);
  }

  approachAndPlace(actorId, supportId, options = {}) {
    this.assertReady('approachAndPlace');
    return this.runtime.interactions.approachAndPlace(actorId, supportId, options);
  }

  dropHeld(actorId) {
    this.assertReady('dropHeld');
    return this.runtime.interactions.dropHeld(actorId);
  }

  markRecoveryHeld(actorId, details) {
    this.assertReady('markRecoveryHeld');
    return this.runtime.interactions.markRecoveryHeld(actorId, details);
  }

  cleanupRecoveryBlocker(actorId, targetId, options = {}) {
    this.assertReady('cleanupRecoveryBlocker');
    return this.runtime.interactions.cleanupRecoveryBlocker(actorId, targetId, options);
  }

  applyStateTransition(id, stateKey, value, meta = {}) {
    this.assertReady('applyStateTransition');
    return this.runtime.applyStateTransition(id, stateKey, value, meta);
  }

  executeAffordance(args = {}, options = {}) {
    this.assertReady('executeAffordance');
    return this.runtime.affordances.execute(args, options);
  }

  repair(report, options = {}) {
    this.assertReady('repair');
    return this.runtime.repair.repair(report, options);
  }

  syncAssetVerification(assetId, manifest) {
    let updated = 0;
    for (const record of this.runtime.store?.values?.() || []) {
      if (record.assetId !== assetId) continue;
      record.manifest.verification = structuredClone(manifest.verification || {});
      if (manifest.compiler?.quality && record.manifest.compiler) {
        record.manifest.compiler.quality = structuredClone(manifest.compiler.quality);
      }
      if (record.object?.userData?.manifest) {
        record.object.userData.manifest.verification = structuredClone(record.manifest.verification);
        if (record.manifest.compiler?.quality && record.object.userData.manifest.compiler) {
          record.object.userData.manifest.compiler.quality = structuredClone(record.manifest.compiler.quality);
        }
      }
      updated += 1;
    }
    return { status:'asset-verification-synced', assetId, instances:updated };
  }
}
