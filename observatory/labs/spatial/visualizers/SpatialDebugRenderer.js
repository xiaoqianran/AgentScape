import * as THREE from "three";

const clearGroup = (group) => {
  for (const child of [...group.children]) {
    group.remove(child);
    child.geometry?.dispose?.();
    if (Array.isArray(child.material)) child.material.forEach((material) => material.dispose?.());
    else child.material?.dispose?.();
  }
};

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
    clearGroup(this.boundsGroup);
    const centers = new Map();
    for (const bound of bounds) {
      const box = new THREE.Box3(
        new THREE.Vector3(...bound.min),
        new THREE.Vector3(...bound.max)
      );
      centers.set(bound.id, new THREE.Vector3(...bound.center));
      const helper = new THREE.Box3Helper(box, 0x7aa2cf);
      helper.renderOrder = 18;
      this.boundsGroup.add(helper);
    }
    for (const [left, right] of collisionPairs) {
      const a = centers.get(left);
      const b = centers.get(right);
      if (!a || !b) continue;
      const line = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([a, b]),
        new THREE.LineBasicMaterial({ color: 0xe26d6d, depthTest: false })
      );
      line.renderOrder = 20;
      this.boundsGroup.add(line);
    }
  }

  updateRay(ray) {
    clearGroup(this.rayGroup);
    if (!ray) return;
    const origin = new THREE.Vector3(...ray.origin);
    const direction = new THREE.Vector3(...ray.direction).normalize();
    const end = origin.clone().addScaledVector(direction, ray.maxDistance);
    const line = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([origin, end]),
      new THREE.LineBasicMaterial({ color: 0x75c6d4, depthTest: false })
    );
    line.renderOrder = 21;
    this.rayGroup.add(line);
    for (const [index, hit] of (ray.hits || []).entries()) {
      const marker = new THREE.Mesh(
        new THREE.SphereGeometry(index === 0 ? 0.09 : 0.055, 12, 8),
        new THREE.MeshBasicMaterial({ color: index === 0 ? 0xf2d06b : 0xb0becb, depthTest: false })
      );
      marker.position.fromArray(hit.point);
      marker.renderOrder = 22;
      this.rayGroup.add(marker);
    }
  }

  updateQueries(snapshot) {
    clearGroup(this.queryGroup);
    const freeSpace = snapshot?.freeSpace?.point;
    if (Array.isArray(freeSpace)) {
      const marker = new THREE.Mesh(
        new THREE.SphereGeometry(0.085, 12, 8),
        new THREE.MeshBasicMaterial({ color: 0x78cf98, depthTest: false })
      );
      marker.position.fromArray(freeSpace);
      marker.renderOrder = 22;
      this.queryGroup.add(marker);
    }
    const support = snapshot?.support;
    if (support?.surface?.center && support?.surface?.size) {
      const [sx, sz] = support.surface.size;
      const plane = new THREE.Mesh(
        new THREE.PlaneGeometry(sx, sz),
        new THREE.MeshBasicMaterial({ color: support.on ? 0x78cf98 : 0xe26d6d, wireframe: true, side: THREE.DoubleSide, depthTest: false })
      );
      plane.rotation.x = -Math.PI / 2;
      plane.position.fromArray(support.surface.center);
      plane.renderOrder = 20;
      this.queryGroup.add(plane);
    }
  }

  dispose() {
    clearGroup(this.boundsGroup);
    clearGroup(this.rayGroup);
    clearGroup(this.queryGroup);
    this.scene.remove(this.boundsGroup, this.rayGroup, this.queryGroup);
  }
}
