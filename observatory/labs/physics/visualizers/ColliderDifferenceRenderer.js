import * as THREE from "three";
import {
  clearVisualGroup,
  createInstrumentLine,
  createInstrumentMarker
} from "../../../visual/DebugVisualPrimitives.js";

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

  clear() { clearVisualGroup(this.group); }

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
      this.group.add(createInstrumentMarker(origin, "fail", { radius: 0.058 }));

      if (row.present && row.manifestPosition && row.physicsPosition) {
        this.group.add(createInstrumentLine(
          [row.manifestPosition, row.physicsPosition],
          "fail",
          { opacity: 0.88, dashed: true }
        ));
      }
    }
  }

  dispose() {
    this.clear();
    this.scene.remove(this.group);
  }
}
