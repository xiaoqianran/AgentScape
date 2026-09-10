import * as THREE from "three";
import { OBSERVATORY_COLORS } from "../../../visual/DebugVisualPrimitives.js";
import { ConvexGeometry } from "three/examples/jsm/geometries/ConvexGeometry.js";

const halfExtentsTuple = (value) => value
  ? [Number(value.x) || 0, Number(value.y) || 0, Number(value.z) || 0]
  : [0, 0, 0];

export const geometryForColliderShape = (shape) => {
  if (!shape) return null;
  if (shape.kind === "box") {
    const [x, y, z] = halfExtentsTuple(shape.halfExtents);
    return new THREE.BoxGeometry(x * 2, y * 2, z * 2);
  }
  if (shape.kind === "cylinder") {
    return new THREE.CylinderGeometry(shape.radius, shape.radius, shape.halfHeight * 2, 24);
  }
  if (shape.kind === "capsule") {
    return new THREE.CapsuleGeometry(shape.radius, shape.halfHeight * 2, 8, 16);
  }
  if (shape.kind === "convexHull" && Array.isArray(shape.vertices) && shape.vertices.length >= 12) {
    const points = [];
    for (let i = 0; i + 2 < shape.vertices.length; i += 3) {
      points.push(new THREE.Vector3(shape.vertices[i], shape.vertices[i + 1], shape.vertices[i + 2]));
    }
    return new ConvexGeometry(points);
  }
  return null;
};

export class NormalizedColliderRenderer {
  constructor(scene) {
    this.scene = scene;
    this.group = new THREE.Group();
    this.group.name = "observatory-normalized-colliders";
    this.material = new THREE.MeshBasicMaterial({
      color: OBSERVATORY_COLORS.structure,
      wireframe: true,
      transparent: true,
      opacity: 0.42,
      depthTest: false
    });
    this.scene.add(this.group);
  }

  setVisible(visible) {
    this.group.visible = Boolean(visible);
  }

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
      mesh.name = `normalized-collider:${collider.objectId}:${collider.partName || "$root"}`;
      mesh.position.fromArray(collider.position || [0, 0, 0]);
      mesh.quaternion.fromArray(collider.rotation || [0, 0, 0, 1]);
      mesh.renderOrder = 18;
      this.group.add(mesh);
    }
  }

  dispose() {
    this.clear();
    this.scene.remove(this.group);
    this.material.dispose();
  }
}
