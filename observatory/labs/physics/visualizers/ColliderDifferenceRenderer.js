import * as THREE from "three";

const DEFAULT_TOLERANCE = Object.freeze({ position: 1e-4, rotation: 1e-4, shape: 1e-5 });

export class ColliderDifferenceRenderer {
  constructor(scene, { tolerance = DEFAULT_TOLERANCE } = {}) {
    this.scene = scene;
    this.tolerance = { ...DEFAULT_TOLERANCE, ...tolerance };
    this.group = new THREE.Group();
    this.group.name = "observatory-collider-differences";
    scene.add(this.group);
  }

  setVisible(visible) { this.group.visible = Boolean(visible); }

  clear() {
    for (const child of [...this.group.children]) {
      this.group.remove(child);
      child.geometry?.dispose?.();
      if (Array.isArray(child.material)) child.material.forEach((material) => material.dispose?.());
      else child.material?.dispose?.();
    }
  }

  update(comparison) {
    this.clear();
    for (const row of comparison?.rows || []) {
      const mismatched = !row.present
        || !row.shapeKindEqual
        || (Number.isFinite(row.positionDelta) && row.positionDelta > this.tolerance.position)
        || (Number.isFinite(row.rotationDelta) && row.rotationDelta > this.tolerance.rotation)
        || (Number.isFinite(row.shapeDelta) && row.shapeDelta > this.tolerance.shape);
      if (!mismatched) continue;

      const origin = row.manifestPosition || row.physicsPosition || [0, 0, 0];
      const marker = new THREE.Mesh(
        new THREE.SphereGeometry(0.075, 12, 8),
        new THREE.MeshBasicMaterial({ color: 0xff5b5b, depthTest: false })
      );
      marker.position.fromArray(origin);
      marker.renderOrder = 24;
      this.group.add(marker);

      if (row.present && row.manifestPosition && row.physicsPosition) {
        const geometry = new THREE.BufferGeometry().setFromPoints([
          new THREE.Vector3(...row.manifestPosition),
          new THREE.Vector3(...row.physicsPosition)
        ]);
        const line = new THREE.Line(
          geometry,
          new THREE.LineBasicMaterial({ color: 0xff5b5b, depthTest: false })
        );
        line.renderOrder = 23;
        this.group.add(line);
      }
    }
  }

  dispose() {
    this.clear();
    this.scene.remove(this.group);
  }
}
