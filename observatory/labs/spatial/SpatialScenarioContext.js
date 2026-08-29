import * as THREE from "three";
import { ObjectStore } from "../../../world/runtime/ObjectStore.js";
import { SpatialSystem } from "../../../world/runtime/systems/SpatialSystem.js";
import { installThreeBvhRuntime, ensureBoundsTrees, bvhRuntimeStatus } from "../../../world/runtime/spatial/ThreeBvhRuntime.js";

export class SpatialScenarioContext {
  constructor({ scene }) {
    this.scene = scene;
    this.store = new ObjectStore();
    this.spatial = new SpatialSystem({ store: this.store, scene });
    this.visuals = [];
    this.lastRay = null;
    this.lastSupport = null;
    this.lastFreeSpace = null;
    this.lastInside = null;
    this.lastStepMs = 0;
    installThreeBvhRuntime();
  }

  async init() { return this; }

  addBox({ id, size = [1, 1, 1], position = [0, 0, 0], manifest = { actions: [] }, color = 0x8fa3b8 }) {
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(...size),
      new THREE.MeshStandardMaterial({ color, roughness: 0.72, metalness: 0.03 })
    );
    mesh.name = id;
    mesh.userData.instanceId = id;
    mesh.position.fromArray(position);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.scene.add(mesh);
    mesh.updateMatrixWorld(true);
    ensureBoundsTrees(mesh);
    this.store.add(id, { id, assetId: id, object: mesh, manifest, state: {} });
    this.visuals.push(mesh);
    return mesh;
  }

  raycast(origin, direction, maxDistance = 100) {
    const hits = this.spatial.raycast(origin, direction, maxDistance);
    this.lastRay = { origin: [...origin], direction: [...direction], maxDistance, hits };
    return hits;
  }

  querySupport(subjectId, targetId, options = {}) {
    const result = this.spatial.supportStatus(subjectId, targetId, options);
    const surface = result?.surfaceId ? this.spatial.getSupportSurface(targetId, result.surfaceId) : null;
    this.lastSupport = {
      ...result,
      surface: surface ? { center: surface.center.toArray(), size: [...surface.size] } : null
    };
    return this.lastSupport;
  }

  queryFreeSpace(objectId, targetId, options = {}) {
    const point = this.spatial.findFreeSpace(objectId, targetId, options);
    this.lastFreeSpace = point ? { objectId, targetId, point: point.toArray(), options: structuredClone(options) } : { objectId, targetId, point: null, options: structuredClone(options) };
    return point;
  }

  queryInside(subjectId, targetId, options = {}) {
    this.lastInside = this.spatial.insideStatus(subjectId, targetId, options);
    return this.lastInside;
  }

  step() {}

  debugSnapshot() {
    const spatial = this.spatial.debugSnapshot();
    return {
      ...spatial,
      bvh: bvhRuntimeStatus(),
      ray: this.lastRay ? structuredClone(this.lastRay) : null,
      support: this.lastSupport ? structuredClone(this.lastSupport) : null,
      freeSpace: this.lastFreeSpace ? structuredClone(this.lastFreeSpace) : null,
      inside: this.lastInside ? structuredClone(this.lastInside) : null
    };
  }

  inspect(id) {
    const bounds = id && this.store.has(id) ? this.spatial.getBounds(id) : null;
    return {
      title: id || "Spatial Runtime",
      kind: "Three.js + three-mesh-bvh",
      values: {
        bvh: bvhRuntimeStatus().raycast,
        boundsMin: bounds?.min || null,
        boundsMax: bounds?.max || null,
        boundsSize: bounds?.size || null,
        rayHits: this.lastRay?.hits?.length ?? 0,
        collisionPairs: this.spatial.debugSnapshot().metrics.collisionPairCount,
        freeSpace: this.lastFreeSpace?.point || null
      }
    };
  }

  dispose() {
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
