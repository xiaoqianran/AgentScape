import * as THREE from 'three';
import { ObjectStore } from '../runtime/ObjectStore.js';
import { PhysicsSystem } from '../runtime/systems/PhysicsSystem.js';
import { disposeObject3D } from '../runtime/disposeObject3D.js';

const finiteVec3 = (v) => [v.x, v.y, v.z].every(Number.isFinite);
const finiteQuat = (q) => [q.x, q.y, q.z, q.w].every(Number.isFinite);
const angularDelta = (a, b) => 2 * Math.acos(Math.min(1, Math.abs(a.dot(b))));

export class ArticulationVerifier {
  constructor({ assets, physicsFactory = () => new PhysicsSystem(), steps = 180, dt = 1 / 60 } = {}) {
    this.assets = assets;
    this.physicsFactory = physicsFactory;
    this.steps = steps;
    this.dt = dt;
  }

  async verify(assetId) {
    const manifest = this.assets.getManifest(assetId);
    const parts = Object.entries(manifest.parts || {}).filter(([, part]) => part.joint && part.physics && Object.keys(part.targets || {}).length);
    if (!parts.length) return { ok: true, assetId, tested: 0, parts: [], note: 'no executable articulation' };

    const { object } = await this.assets.instantiate(assetId);
    const physics = this.physicsFactory();
    const store = new ObjectStore();
    const instanceId = `verify_${assetId}`;
    store.add(instanceId, { id: instanceId, assetId, object, manifest, state: {} });

    try {
      await physics.init();
      physics.attach(instanceId, manifest, object);
      const reports = [];
      for (const [partName, part] of parts) reports.push(this.verifyPart({ physics, store, object, instanceId, partName, part }));
      return { ok: reports.every((report) => report.ok), assetId, tested: reports.length, parts: reports };
    } finally {
      physics.dispose();
      disposeObject3D(object);
    }
  }

  verifyPart({ physics, store, object, instanceId, partName, part }) {
    const node = object.getObjectByName(part.node);
    if (!node) return { ok: false, part: partName, error: `missing node: ${part.node}` };
    const actions = Object.entries(part.targets).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]));
    const reports = [];

    for (const [action, target] of actions) {
      const beforePosition = node.position.clone();
      const beforeRotation = node.quaternion.clone();
      const accepted = physics.setArticulationTarget(instanceId, partName, target);
      for (let i = 0; i < this.steps; i++) physics.step(this.dt, store);
      const positionDelta = node.position.distanceTo(beforePosition);
      const rotationDelta = angularDelta(node.quaternion, beforeRotation);
      const finite = finiteVec3(node.position) && finiteQuat(node.quaternion);
      const movement = part.joint.type === 'prismatic' ? positionDelta : rotationDelta;
      reports.push({ action, target, accepted, finite, positionDelta, rotationDelta, moved: movement > 0.01 });
    }

    return {
      ok: reports.every((report) => report.accepted && report.finite && report.moved),
      part: partName,
      node: part.node,
      jointType: part.joint.type,
      limits: [...part.joint.limits],
      actions: reports
    };
  }
}
