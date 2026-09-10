import * as THREE from "three";
import {
  clearVisualGroup,
  createInstrumentBounds,
  createInstrumentLine,
  createInstrumentMarker,
  createInstrumentSurface
} from "../../../visual/DebugVisualPrimitives.js";

export class SpatialDebugRenderer {
  constructor(scene) {
    this.scene = scene;
    this.boundsGroup = new THREE.Group();
    this.rayGroup = new THREE.Group();
    this.queryGroup = new THREE.Group();
    this.boundsGroup.name = "observatory-spatial-bounds";
    this.rayGroup.name = "observatory-spatial-ray";
    this.queryGroup.name = "observatory-spatial-query";
    scene.add(this.boundsGroup, this.rayGroup, this.queryGroup);
  }

  setBoundsVisible(visible) { this.boundsGroup.visible = Boolean(visible); }
  setRayVisible(visible) { this.rayGroup.visible = Boolean(visible); }
  setQueryVisible(visible) { this.queryGroup.visible = Boolean(visible); }

  update(snapshot) {
    this.updateBounds(snapshot?.bounds || [], snapshot?.collisionPairs || []);
    this.updateRay(snapshot?.ray || null);
    this.updateQueries(snapshot);
  }

  updateBounds(bounds, collisionPairs) {
    clearVisualGroup(this.boundsGroup);
    const centers = new Map();
    for (const bound of bounds) {
      centers.set(bound.id, new THREE.Vector3(...bound.center));
      this.boundsGroup.add(createInstrumentBounds(bound.min, bound.max, "structure"));
    }
    for (const [left, right] of collisionPairs) {
      const a = centers.get(left);
      const b = centers.get(right);
      if (!a || !b) continue;
      this.boundsGroup.add(createInstrumentLine([a, b], "fail", { opacity: 0.78, dashed: true }));
      this.boundsGroup.add(createInstrumentMarker(a.toArray(), "fail", { radius: 0.035, ring: false }));
      this.boundsGroup.add(createInstrumentMarker(b.toArray(), "fail", { radius: 0.035, ring: false }));
    }
  }

  updateRay(ray) {
    clearVisualGroup(this.rayGroup);
    if (!ray) return;
    const origin = new THREE.Vector3(...ray.origin);
    const direction = new THREE.Vector3(...ray.direction).normalize();
    const end = origin.clone().addScaledVector(direction, ray.maxDistance);
    this.rayGroup.add(createInstrumentLine([origin, end], "info", { opacity: 0.78 }));
    this.rayGroup.add(createInstrumentMarker(origin.toArray(), "info", { radius: 0.035, ring: false }));
    for (const [index, hit] of (ray.hits || []).entries()) {
      this.rayGroup.add(createInstrumentMarker(
        hit.point,
        index === 0 ? "warn" : "muted",
        { radius: index === 0 ? 0.06 : 0.04, ring: index === 0 }
      ));
    }
  }

  updateQueries(snapshot) {
    clearVisualGroup(this.queryGroup);
    const freeSpace = snapshot?.freeSpace?.point;
    if (Array.isArray(freeSpace)) {
      this.queryGroup.add(createInstrumentMarker(freeSpace, "pass", { radius: 0.065 }));
    }
    const support = snapshot?.support;
    if (support?.surface?.center && support?.surface?.size) {
      this.queryGroup.add(createInstrumentSurface(
        support.surface.center,
        support.surface.size,
        support.on ? "pass" : "fail",
        { opacity: support.on ? 0.1 : 0.08 }
      ));
    }
  }

  dispose() {
    clearVisualGroup(this.boundsGroup);
    clearVisualGroup(this.rayGroup);
    clearVisualGroup(this.queryGroup);
    this.scene.remove(this.boundsGroup, this.rayGroup, this.queryGroup);
  }
}
