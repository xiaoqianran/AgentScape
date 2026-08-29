import * as THREE from "three";
import { ObjectStore } from "../../../world/runtime/ObjectStore.js";
import { PhysicsSystem } from "../../../world/runtime/systems/PhysicsSystem.js";
import { assetManifests } from "../../../asset/manifests/index.js";
import { manifestColliderSnapshot, compareManifestToPhysics } from "./ManifestColliderSnapshot.js";

const makeMaterial = (color) => new THREE.MeshStandardMaterial({ color, roughness: 0.68, metalness: 0.04 });

export class PhysicsScenarioContext {
  constructor({ scene, backend }) {
    if (!backend) throw new TypeError("PhysicsScenarioContext requires a physics backend");
    this.scene = scene;
    this.physics = new PhysicsSystem({ backend });
    this.store = new ObjectStore();
    this.entities = new Map();
    this.visuals = [];
    this.lastStepMs = 0;
  }

  async init() {
    await this.physics.init();
    return this;
  }

  addBox({ id, position = [0, 0, 0], rotation = [0, 0, 0, 1], halfExtents = [0.5, 0.5, 0.5], type = "dynamic", mass = 1, friction = 0.7, accent = false }) {
    const geometry = new THREE.BoxGeometry(halfExtents[0] * 2, halfExtents[1] * 2, halfExtents[2] * 2);
    const material = makeMaterial(accent ? 0xd6a44b : type === "fixed" ? 0x687482 : 0xa8b2c1);
    const object = new THREE.Mesh(geometry, material);
    object.name = id;
    object.castShadow = true;
    object.receiveShadow = true;
    object.position.fromArray(position);
    object.quaternion.fromArray(rotation);
    this.scene.add(object);
    object.updateMatrixWorld(true);

    const manifest = {
      id,
      type: "observatory-fixture",
      source: { kind: "builtin" },
      actions: [],
      physics: { body: type, mass, friction, colliders: [{ shape: "box", halfExtents }] }
    };
    this.store.add(id, { id, assetId: id, object, manifest, state: {} });
    this.physics.attach(id, manifest, object);
    this.entities.set(id, { id, kind: "rigid-body", initialPosition: [...position] });
    this.visuals.push(object);
    return object;
  }

  addAssetInstance({ id, assetId, object, manifest, position = [0, 0, 0], initialState = {}, inspectPart = null, target = null }) {
    if (!id || !assetId || !object || !manifest) throw new TypeError("addAssetInstance requires id, assetId, object, and manifest");
    object.position.fromArray(position);
    object.userData.instanceId = id;
    this.scene.add(object);
    object.updateMatrixWorld(true);
    this.store.add(id, { id, assetId, object, manifest, state: structuredClone(initialState) });
    this.physics.attach(id, manifest, object);
    if (inspectPart) {
      if (Number.isFinite(target)) this.physics.setArticulationTarget(id, inspectPart, target);
      this.entities.set(id, { id, kind: "articulation", partName: inspectPart, target });
    } else {
      this.entities.set(id, { id, kind: "rigid-body", initialPosition: [...position] });
    }
    this.visuals.push(object);
    return object;
  }

  addHingeCabinet({ id = "cabinet_01", target = -1 } = {}) {
    const root = new THREE.Group();
    root.name = id;
    const cabinet = new THREE.Mesh(new THREE.BoxGeometry(1.7, 2, 0.64), makeMaterial(0x687482));
    cabinet.position.set(0, 1, -0.04);
    cabinet.castShadow = true;
    cabinet.receiveShadow = true;
    root.add(cabinet);

    const hinge = new THREE.Group();
    hinge.name = "doorHinge";
    hinge.position.set(-0.82, 1, 0.39);
    root.add(hinge);
    const door = new THREE.Mesh(new THREE.BoxGeometry(1.62, 1.9, 0.08), makeMaterial(0xd6a44b));
    door.position.set(0.81, 0, 0);
    door.castShadow = true;
    hinge.add(door);
    this.scene.add(root);
    root.updateMatrixWorld(true);

    // Synthetic render geometry is allowed; the semantic/physics contract is not copied.
    // Reuse the production cabinet manifest so Observatory detects, rather than creates,
    // contract drift.
    const manifest = structuredClone(assetManifests.cabinet);


    this.store.add(id, { id, assetId: manifest.id, object: root, manifest, state: { parts: { door: "close" } } });
    this.physics.attach(id, manifest, root);
    this.physics.setArticulationTarget(id, "door", target);
    this.entities.set(id, { id, kind: "articulation", partName: "door", target });
    this.visuals.push(root);
    return root;
  }

  step(dt) { this.physics.step(dt, this.store); }
  position(id) { return this.physics.getPosition(id); }
  motion(id) { return this.physics.bodyMotionState(id); }
  articulation(id, partName, target) { return this.physics.articulationState(id, partName, { target }); }

  inspect(id) {
    const entity = this.entities.get(id);
    if (!entity) return null;
    if (entity.kind === "articulation") {
      const state = this.articulation(id, entity.partName, entity.target);
      return { title: `${id} / ${entity.partName}`, kind: `${this.physics.backend.identity} 旋转关节`, values: { coordinate: state?.coordinate, target: state?.target, error: state?.error, tolerance: state?.tolerance, jointType: state?.jointType } };
    }
    const motion = this.motion(id);
    const body = this.physics.entries.get(id)?.body;
    return { title: id, kind: `${this.physics.backend.identity} 刚体`, values: { position: this.position(id), bodyType: body ? this.physics.backend.bodyType(body) : null, sleeping: motion?.sleeping, linearSpeed: motion?.linearSpeed, angularSpeed: motion?.angularSpeed, linearVelocity: motion?.linearVelocity } };
  }

  debugSnapshot({ nativeGeometry = true, contacts = true } = {}) {
    return this.physics.debugSnapshot({ nativeGeometry, contacts });
  }

  manifestSnapshot() {
    return manifestColliderSnapshot(this.store);
  }

  truthComparison() {
    return compareManifestToPhysics(this.manifestSnapshot(), this.debugSnapshot({ nativeGeometry:false }));
  }

  profile() { return this.physics.profile(); }

  dispose() {
    this.physics.dispose();
    for (const object of this.visuals) {
      this.scene.remove(object);
      object.traverse?.((node) => {
        node.geometry?.dispose?.();
        if (Array.isArray(node.material)) node.material.forEach((material) => material.dispose?.());
        else node.material?.dispose?.();
      });
    }
    this.visuals = [];
    this.entities.clear();
    this.store.clear();
  }
}
