import * as THREE from "three";

const clearGroup = (group) => {
  for (const child of [...group.children]) {
    group.remove(child);
    child.geometry?.dispose?.();
    if (Array.isArray(child.material)) child.material.forEach((material) => material.dispose?.());
    else child.material?.dispose?.();
  }
};

const marker = (point, color, radius = 0.07) => {
  const mesh = new THREE.Mesh(
    new THREE.SphereGeometry(radius, 12, 8),
    new THREE.MeshBasicMaterial({ color, depthTest: false })
  );
  mesh.position.fromArray(point);
  mesh.renderOrder = 24;
  return mesh;
};

export class InteractionDebugRenderer {
  constructor(scene) {
    this.scene = scene;
    this.losGroup = new THREE.Group();
    this.supportGroup = new THREE.Group();
    this.stateGroup = new THREE.Group();
    this.losGroup.name = "observatory-interaction-los";
    this.supportGroup.name = "observatory-interaction-support";
    this.stateGroup.name = "observatory-interaction-state";
    scene.add(this.losGroup, this.supportGroup, this.stateGroup);
  }

  setLosVisible(visible) { this.losGroup.visible = Boolean(visible); }
  setSupportVisible(visible) { this.supportGroup.visible = Boolean(visible); }
  setStateVisible(visible) { this.stateGroup.visible = Boolean(visible); }

  update(snapshot) {
    this.updateLos(snapshot?.reach || null);
    this.updateSupport(snapshot?.supportSurface || null, snapshot?.support || null);
    this.updateState(snapshot);
  }

  updateLos(reach) {
    clearGroup(this.losGroup);
    const eye = reach?.lineOfSight?.eye;
    const aim = reach?.lineOfSight?.aim;
    if (!Array.isArray(eye) || !Array.isArray(aim)) return;
    const color = reach.visible ? 0x6fd59b : 0xe26d6d;
    const line = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(...eye), new THREE.Vector3(...aim)]),
      new THREE.LineBasicMaterial({ color, depthTest: false })
    );
    line.renderOrder = 22;
    this.losGroup.add(line, marker(eye, 0x78c8e8, 0.06), marker(aim, 0xf0cf6d, 0.06));
    const hit = reach.lineOfSight?.hit;
    if (hit && Number.isFinite(hit.distance)) {
      const direction = new THREE.Vector3(...aim).sub(new THREE.Vector3(...eye)).normalize();
      const point = new THREE.Vector3(...eye).addScaledVector(direction, hit.distance);
      this.losGroup.add(marker(point.toArray(), reach.visible ? 0x6fd59b : 0xff5b5b, 0.085));
    }
  }

  updateSupport(surface, support) {
    clearGroup(this.supportGroup);
    if (!surface?.center || !surface?.size) return;
    const [sx, sz] = surface.size;
    const plane = new THREE.Mesh(
      new THREE.PlaneGeometry(sx, sz),
      new THREE.MeshBasicMaterial({
        color: support?.on ? 0x6fd59b : 0xe8b866,
        wireframe: true,
        side: THREE.DoubleSide,
        depthTest: false
      })
    );
    plane.rotation.x = -Math.PI / 2;
    plane.position.fromArray(surface.center);
    plane.renderOrder = 20;
    this.supportGroup.add(plane);
  }

  updateState(snapshot) {
    clearGroup(this.stateGroup);
    const heldId = snapshot?.held?.human;
    if (!heldId) return;
    const body = snapshot?.physics?.bodies?.find((item) => item.objectId === heldId);
    if (!body?.position) return;
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(0.24, 0.025, 8, 24),
      new THREE.MeshBasicMaterial({ color: 0xf0cf6d, depthTest: false })
    );
    ring.rotation.x = Math.PI / 2;
    ring.position.fromArray(body.position);
    ring.renderOrder = 23;
    this.stateGroup.add(ring);
  }

  dispose() {
    clearGroup(this.losGroup);
    clearGroup(this.supportGroup);
    clearGroup(this.stateGroup);
    this.scene.remove(this.losGroup, this.supportGroup, this.stateGroup);
  }
}
