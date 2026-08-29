import * as THREE from "three";
import { geometryForColliderShape } from "./NormalizedColliderRenderer.js";

export class ManifestColliderRenderer {
  constructor(scene) {
    this.scene = scene;
    this.group = new THREE.Group();
    this.group.name = "observatory-manifest-colliders";
    this.material = new THREE.MeshBasicMaterial({
      color: 0xe3b85c,
      wireframe: true,
      transparent: true,
      opacity: 0.42,
      depthTest: false
    });
    scene.add(this.group);
  }

  setVisible(visible) { this.group.visible = Boolean(visible); }

  clear() {
    for (const child of [...this.group.children]) {
      this.group.remove(child);
      child.geometry?.dispose?.();
    }
  }

  update(snapshot) {
    this.clear();
    for (const collider of snapshot?.colliders || []) {
      const geometry = geometryForColliderShape(collider.shape);
      if (!geometry) continue;
      const mesh = new THREE.Mesh(geometry, this.material);
      mesh.name = `manifest-collider:${collider.objectId}:${collider.partName}:${collider.colliderIndex}`;
      mesh.position.fromArray(collider.position || [0, 0, 0]);
      mesh.quaternion.fromArray(collider.rotation || [0, 0, 0, 1]);
      mesh.renderOrder = 19;
      this.group.add(mesh);
    }
  }

  dispose() {
    this.clear();
    this.scene.remove(this.group);
    this.material.dispose();
  }
}
