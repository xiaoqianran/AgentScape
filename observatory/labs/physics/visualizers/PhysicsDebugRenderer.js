import * as THREE from "three";

export class PhysicsDebugRenderer {
  constructor(scene) {
    this.scene = scene;
    this.geometry = new THREE.BufferGeometry();
    this.material = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.9, depthTest: false });
    this.lines = new THREE.LineSegments(this.geometry, this.material);
    this.lines.renderOrder = 20;
    scene.add(this.lines);
  }

  setVisible(visible) { this.lines.visible = Boolean(visible); }

  update(debug) {
    const rawVertices = debug?.vertices;
    if (!rawVertices?.length) {
      this.geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(), 3));
      this.geometry.setAttribute("color", new THREE.BufferAttribute(new Float32Array(), 3));
      return;
    }
    const vertices = rawVertices instanceof Float32Array ? rawVertices : new Float32Array(rawVertices);
    const source = debug.colors || [];
    const vertexCount = vertices.length / 3;
    const components = source.length === vertexCount * 4 ? 4 : 3;
    const colors = new Float32Array(vertexCount * 3);
    for (let vertex = 0; vertex < vertexCount; vertex += 1) {
      colors[vertex * 3] = source[vertex * components] ?? 0.4;
      colors[vertex * 3 + 1] = source[vertex * components + 1] ?? 0.9;
      colors[vertex * 3 + 2] = source[vertex * components + 2] ?? 0.6;
    }
    this.geometry.setAttribute("position", new THREE.BufferAttribute(vertices, 3));
    this.geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    this.geometry.computeBoundingSphere();
  }

  dispose() {
    this.scene.remove(this.lines);
    this.geometry.dispose();
    this.material.dispose();
  }
}
