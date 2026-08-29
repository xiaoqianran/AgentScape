import * as THREE from "three";
import { createAssetModule } from "../../../generation/orchestration/createAssetModule.js";
import { EventBus } from "../../../core/EventBus.js";
import { ObjectStore } from "../../../world/runtime/ObjectStore.js";
import { PhysicsSystem } from "../../../world/runtime/systems/PhysicsSystem.js";
import { RapierPhysicsBackend } from "../../../world/runtime/physics/RapierPhysicsBackend.js";
import { SpatialSystem } from "../../../world/runtime/systems/SpatialSystem.js";
import { InteractionSystem } from "../../../world/runtime/systems/InteractionSystem.js";
import { installThreeBvhRuntime, ensureBoundsTrees } from "../../../world/runtime/spatial/ThreeBvhRuntime.js";

export class InteractionScenarioContext {
  constructor({ scene }) {
    this.scene = scene;
    this.assetModule = createAssetModule();
    this.assets = this.assetModule.manager;
    this.store = new ObjectStore();
    this.events = new EventBus();
    this.eventLog = [];
    this.physics = new PhysicsSystem({ backend: new RapierPhysicsBackend() });
    this.spatial = new SpatialSystem({ store: this.store, scene });
    this.interaction = new InteractionSystem({
      store: this.store,
      physics: this.physics,
      spatial: this.spatial,
      events: this.events
    });
    this.visuals = [];
    this.lastAction = null;
    this.lastReach = null;
    this.debugCamera = new THREE.PerspectiveCamera();
    this.lastSupport = null;
    this.lastSupportSurface = null;
    this.transition = null;
    this.events.on("*", (event) => this.eventLog.push(structuredClone(event)));
    installThreeBvhRuntime();
  }

  async init() {
    await this.physics.init();
    this.floorBody = this.physics.addFloor();
    return this;
  }

  async addAsset({ id, assetId, position = [0, 0, 0] }) {
    const { object, manifest } = await this.assets.instantiate(assetId);
    object.position.fromArray(position);
    object.userData.instanceId = id;
    this.scene.add(object);
    object.updateMatrixWorld(true);
    ensureBoundsTrees(object);
    this.store.add(id, { id, assetId, object, manifest, state: {} });
    this.physics.attach(id, manifest, object);
    this.visuals.push(object);
    return object;
  }

  addBlocker({ id = "blocker", size = [0.5, 2.2, 0.5], position = [0, 1.1, 0], color = 0x9e6d64 }) {
    const object = new THREE.Mesh(
      new THREE.BoxGeometry(...size),
      new THREE.MeshStandardMaterial({ color, roughness: 0.75, metalness: 0.02 })
    );
    object.name = id;
    object.userData.instanceId = id;
    object.position.fromArray(position);
    this.scene.add(object);
    object.updateMatrixWorld(true);
    ensureBoundsTrees(object);
    const manifest = {
      id: "observatory-blocker",
      type: "obstacle",
      source: { kind: "builtin" },
      actions: [],
      physics: { body: "fixed", colliders: [{ shape: "box", halfExtents: size.map((v) => v / 2) }] }
    };
    this.store.add(id, { id, assetId: manifest.id, object, manifest, state: {} });
    this.physics.attach(id, manifest, object);
    this.visuals.push(object);
    return object;
  }

  step(frames = 1) {
    for (let i = 0; i < frames; i += 1) this.physics.step(1 / 60, this.store);
  }

  advance(frames = 1) {
    for (let i = 0; i < frames; i += 1) {
      this.physics.step(1 / 60, this.store);
      this.interaction.update(1 / 60, this.debugCamera);
    }
  }

  pickup(id) {
    this.lastAction = { name: "pickup", result: this.interaction.pickup(id) };
    return this.lastAction.result;
  }

  drop(id) {
    this.lastAction = { name: "drop", result: this.interaction.drop(id) };
    return this.lastAction.result;
  }

  place(id, targetId, options = {}) {
    this.lastAction = { name: "place", result: this.interaction.place(id, targetId, options) };
    this.lastSupport = this.spatial.supportStatus(id, targetId, { surfaceId: options.surfaceId || null });
    if (this.lastSupport?.surfaceId) {
      const surface = this.spatial.getSupportSurface(targetId, this.lastSupport.surfaceId);
      this.lastSupportSurface = surface ? { center: surface.center.toArray(), size: [...surface.size] } : null;
    }
    return this.lastAction.result;
  }

  interactionStatus(actorId, targetId, options = {}) {
    this.lastReach = this.interaction.interactionStatus(actorId, targetId, options);
    return this.lastReach;
  }

  debugSnapshot({ actorId = null, targetId = null, maxDistance } = {}) {
    const interaction = this.interaction.debugSnapshot({ actorId, targetId, ...(maxDistance ? { maxDistance } : {}) });
    return {
      ...interaction,
      action: this.lastAction ? structuredClone(this.lastAction) : null,
      reach: this.lastReach ? structuredClone(this.lastReach) : interaction.reach,
      support: this.lastSupport ? structuredClone(this.lastSupport) : null,
      supportSurface: this.lastSupportSurface ? structuredClone(this.lastSupportSurface) : null,
      transition: this.transition ? structuredClone(this.transition) : null,
      events: this.eventLog.map((event) => structuredClone(event)),
      physics: this.physics.debugSnapshot({ nativeGeometry: false, contacts: true })
    };
  }

  inspect(id = null) {
    const position = id && this.store.has(id) ? this.physics.getPosition(id) : null;
    const state = id && this.store.has(id) ? this.store.get(id).state : null;
    return {
      title: id || "Interaction Runtime",
      kind: "InteractionSystem + Rapier + SpatialSystem",
      values: {
        position,
        heldBy: state?.heldBy || null,
        humanHeld: this.interaction.heldId,
        lastAction: this.lastAction?.name || null,
        lastResult: this.lastAction?.result || null,
        interactable: this.lastReach?.interactable ?? null,
        inRange: this.lastReach?.inRange ?? null,
        visible: this.lastReach?.visible ?? null,
        blocker: this.lastReach?.lineOfSight?.hit?.id || null,
        supportOn: this.lastSupport?.on ?? null,
        eventCount: this.eventLog.length
      }
    };
  }

  dispose() {
    this.interaction.cancelPending("OBSERVATORY_DISPOSED");
    this.physics.dispose();
    this.events.clear();
    for (const object of this.visuals) {
      this.scene.remove(object);
      object.traverse?.((node) => {
        node.geometry?.disposeBoundsTree?.();
        node.geometry?.dispose?.();
        if (Array.isArray(node.material)) node.material.forEach((material) => material.dispose?.());
        else node.material?.dispose?.();
      });
    }
    this.visuals = [];
    this.store.clear();
  }
}
