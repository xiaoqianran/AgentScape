import * as THREE from "three";
import { ObjectStore } from "../../../world/runtime/ObjectStore.js";
import { NavigationSystem } from "../../../world/runtime/systems/NavigationSystem.js";
import { RecastNavigationBackend } from "../../../world/runtime/navigation/RecastNavigationBackend.js";

export class NavigationScenarioContext {
  constructor({ scene }) {
    this.scene = scene;
    this.store = new ObjectStore();
    this.environmentRoots = [];
    this.physics = null;
    this.backend = new RecastNavigationBackend();
    this.navigation = this.createNavigation();
    this.visuals = [];
    this.lastRoute = null;
    this.lastDiagnosis = null;
    this.lastBuild = null;
    this.transition = null;
    this.lastStepMs = 0;
    this.debugRevision = 0;
  }

  createNavigation() {
    return new NavigationSystem({
      store: this.store,
      physics: this.physics,
      environmentRoots: this.environmentRoots,
      backend: this.backend
    });
  }

  async init() { return this; }

  markDebugDirty() {
    this.debugRevision += 1;
    return this.debugRevision;
  }

  async enableRapierPhysics() {
    if (this.physics) return this.physics;
    const [{ PhysicsSystem }, { RapierPhysicsBackend }] = await Promise.all([
      import("../../../world/runtime/systems/PhysicsSystem.js"),
      import("../../../world/runtime/physics/RapierPhysicsBackend.js")
    ]);
    this.physics = new PhysicsSystem({ backend: new RapierPhysicsBackend() });
    await this.physics.init();
    this.navigation.dispose();
    this.backend = new RecastNavigationBackend();
    this.navigation = this.createNavigation();
    return this.physics;
  }

  addStaticBox({ id, size = [1, 1, 1], position = [0, 0, 0], color = 0x7a8797, navigationIgnore = false }) {
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(...size),
      new THREE.MeshStandardMaterial({ color, roughness: 0.78, metalness: 0.02 })
    );
    mesh.name = id;
    mesh.userData.instanceId = id;
    mesh.userData.navigationIgnore = Boolean(navigationIgnore);
    mesh.position.fromArray(position);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.scene.add(mesh);
    mesh.updateMatrixWorld(true);
    this.store.add(id, {
      id,
      assetId: id,
      object: mesh,
      manifest: { source: { kind: "builtin" }, actions: [], physics: { body: "fixed" } },
      state: {}
    });
    this.visuals.push(mesh);
    this.navigation.invalidate(`fixture:${id}`);
    this.markDebugDirty();
    return mesh;
  }

  addArticulatedDoor({ id = "door-blocker", halfExtents = [0.25, 1, 4], position = [0, 1, 0], openTarget = -1.2 } = {}) {
    if (!this.physics) throw new Error("addArticulatedDoor requires enableRapierPhysics() first");
    const root = new THREE.Group();
    root.name = id;
    root.userData.instanceId = id;
    const door = new THREE.Mesh(
      new THREE.BoxGeometry(halfExtents[0] * 2, halfExtents[1] * 2, halfExtents[2] * 2),
      new THREE.MeshStandardMaterial({ color: 0xb17867, roughness: 0.68, metalness: 0.03 })
    );
    door.name = "Door";
    door.position.fromArray(position);
    door.castShadow = true;
    door.receiveShadow = true;
    root.add(door);
    this.scene.add(root);
    root.updateMatrixWorld(true);

    const manifest = {
      id: "observatory-door-blocker",
      type: "door",
      source: { kind: "builtin" },
      actions: ["open", "close"],
      physics: { body: "fixed", colliders: [] },
      parts: {
        door: {
          node: "Door",
          actions: ["open", "close"],
          targets: { open: openTarget, close: 0 },
          physics: {
            body: "dynamic",
            mass: 8,
            colliders: [{ shape: "box", halfExtents: [...halfExtents] }]
          },
          joint: {
            type: "revolute",
            axis: [0, 1, 0],
            limits: [openTarget, 0],
            parentAnchor: [...position],
            childAnchor: [0, 0, 0],
            motor: { stiffness: 55, damping: 10 }
          }
        }
      }
    };
    this.store.add(id, {
      id,
      assetId: manifest.id,
      object: root,
      manifest,
      state: { parts: { door: "close" } }
    });
    this.physics.attach(id, manifest, root);
    this.visuals.push(root);
    this.navigation.invalidate(`fixture:${id}`);
    this.markDebugDirty();
    return root;
  }

  stepPhysics(frames = 1) {
    if (!this.physics) return;
    for (let frame = 0; frame < frames; frame += 1) this.physics.step(1 / 60, this.store);
    if (frames > 0) this.markDebugDirty();
  }

  async rebuild() {
    this.lastBuild = await this.navigation.rebuild();
    this.markDebugDirty();
    return this.lastBuild;
  }

  async findPath(start, end, options = {}) {
    const started = performance.now();
    this.lastDiagnosis = null;
    this.lastRoute = await this.navigation.findPath(start, end, options);
    this.lastStepMs = performance.now() - started;
    this.markDebugDirty();
    return this.lastRoute;
  }

  async diagnoseActions(start, end, options = {}) {
    const started = performance.now();
    this.lastDiagnosis = await this.navigation.suggestActions(start, end, options);
    this.lastRoute = this.lastDiagnosis.current;
    this.lastStepMs = performance.now() - started;
    this.markDebugDirty();
    return this.lastDiagnosis;
  }

  step() {}

  debugSnapshot() {
    return {
      ...this.navigation.debugSnapshot(),
      route: this.lastRoute ? structuredClone(this.lastRoute) : null,
      diagnosis: this.lastDiagnosis ? structuredClone(this.lastDiagnosis) : null,
      transition: this.transition ? structuredClone(this.transition) : null,
      build: this.lastBuild ? structuredClone(this.lastBuild) : null,
      physicsObstacles: this.physics ? this.physics.navigationObstacles() : null
    };
  }

  inspect() {
    const debug = this.debugSnapshot();
    return {
      title: "Recast Navigation",
      kind: this.physics ? "PhysicsSystem → NavigationSystem → Recast" : "NavigationSystem + RecastNavigationBackend",
      values: {
        state: debug.status.state,
        backend: debug.status.backend.identity,
        navVertices: debug.navMesh.vertexCount,
        navTriangles: debug.navMesh.triangleCount,
        reachable: debug.route?.reachable ?? null,
        reason: debug.route?.reason ?? null,
        cost: debug.route?.cost ?? null,
        waypointCount: debug.route?.path?.length ?? 0,
        trackedObstacles: debug.obstacles?.length ?? 0,
        diagnosis: debug.diagnosis?.status ?? null,
        recommendation: debug.diagnosis?.recommendation?.call?.name ?? null,
        beforeReachable: debug.transition?.closed?.reachable ?? null,
        afterReachable: debug.transition?.opened?.reachable ?? null,
        obstacleAngle: debug.obstacles?.[0]?.angle ?? null,
        snappedStart: debug.route?.start?.snapped ?? null,
        snappedEnd: debug.route?.end?.snapped ?? null
      }
    };
  }

  dispose() {
    this.navigation.dispose();
    this.physics?.dispose?.();
    this.physics = null;
    for (const object of this.visuals) {
      this.scene.remove(object);
      object.traverse?.((node) => {
        node.geometry?.dispose?.();
        if (Array.isArray(node.material)) node.material.forEach((material) => material.dispose?.());
        else node.material?.dispose?.();
      });
    }
    this.visuals = [];
    this.store.clear();
  }
}
