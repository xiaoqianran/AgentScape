import { assetAdmission } from '../../asset/model/admission.js';

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
