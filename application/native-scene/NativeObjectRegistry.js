import * as THREE from 'three';

const fail = code => Object.assign(new Error(code), { code });
const OBJECT_ID = /^[A-Za-z][A-Za-z0-9_:-]{0,127}$/;

/**
 * References host-owned Object3D instances without adopting their resources.
 * Registered objects are discoverable; only entries with activate() become
 * provisional environment interactions. They never enter the Runtime ObjectStore.
 */
export class NativeObjectRegistry {
  constructor(hostScene) {
    this.hostScene = hostScene;
    this.managedRoot = null;
    this.objects = new Map();
    this.objectIds = new WeakMap();
    this.interactions = [];
    this.closed = false;
  }

  setManagedRoot(root) { this.managedRoot = root; }

  isHostObject(object) {
    let current = object;
    while (current) {
      if (current === this.managedRoot) return false;
      if (current === this.hostScene) return object !== this.hostScene;
      current = current.parent;
    }
    return false;
  }

  registerObject({ id, object, label = id, activate = null, contractId = null } = {}) {
    if (this.closed) throw fail('NATIVE_OBJECT_REGISTRY_CLOSED');
    if (typeof id !== 'string' || !OBJECT_ID.test(id)) throw fail('NATIVE_OBJECT_ID_INVALID');
    if (!object?.isObject3D || !this.isHostObject(object)) throw fail('NATIVE_OBJECT_NOT_IN_HOST');
    if (this.objects.has(id) || this.objectIds.has(object)) throw fail('NATIVE_OBJECT_ALREADY_REGISTERED');
    if (typeof label !== 'string' || !label.trim() || label.length > 256) throw fail('NATIVE_OBJECT_LABEL_INVALID');
    if (activate != null && typeof activate !== 'function') throw fail('NATIVE_OBJECT_ACTIVATION_INVALID');
    if (contractId != null && (typeof contractId !== 'string' || !contractId.trim())) throw fail('NATIVE_OBJECT_CONTRACT_INVALID');
    if (contractId && !activate) throw fail('NATIVE_OBJECT_CONTRACT_REQUIRES_ACTIVATION');

    const entry = { id, object, label, activate, contractId };
    this.objects.set(id, entry);
    this.objectIds.set(object, id);
    if (activate) this.interactions.push({
      id, object, label, activate, ...(contractId ? { contractId } : {})
    });
    return this.describe(entry);
  }

  describe(entry) {
    entry.object.updateWorldMatrix(true, false);
    const position = new THREE.Vector3().setFromMatrixPosition(entry.object.matrixWorld);
    return {
      id: entry.id, label: entry.label,
      position: position.toArray(),
      interactive: Boolean(entry.activate),
      contractId: entry.contractId
    };
  }

  listObjects() {
    this.pruneDetached();
    return [...this.objects.values()].map(entry => this.describe(entry));
  }

  unregisterObject(id) {
    if (this.closed) return false;
    const entry = this.objects.get(id);
    if (!entry) return false;
    this.objects.delete(id);
    this.objectIds.delete(entry.object);
    const index = this.interactions.findIndex(item => item.id === id);
    if (index !== -1) this.interactions.splice(index, 1);
    return true;
  }

  pruneDetached() {
    if (this.closed) return;
    for (const [id, entry] of this.objects) {
      if (!this.isHostObject(entry.object)) this.unregisterObject(id);
    }
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    this.objects.clear();
    this.interactions.length = 0;
  }
}
