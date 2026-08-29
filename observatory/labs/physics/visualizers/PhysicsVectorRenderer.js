import * as THREE from "three";

const COLORS = Object.freeze({
  velocity: 0x6fa8dc,
  joint: 0xe0b85a,
  contact: 0xdf7373,
  contactPair: 0x8d99a8
});

const clearGroup = (group) => {
  for (const child of [...group.children]) {
    group.remove(child);
    child.traverse?.((node) => {
      node.geometry?.dispose?.();
      if (Array.isArray(node.material)) node.material.forEach((material) => material.dispose?.());
      else node.material?.dispose?.();
    });
  }
};

const finiteVector = (value, size = 3) => Array.isArray(value)
  && value.length >= size
  && value.slice(0, size).every(Number.isFinite);

const arrow = (direction, origin, length, color) => {
  const dir = new THREE.Vector3(...direction);
  const magnitude = dir.length();
  if (!(magnitude > 1e-8)) return null;
  dir.multiplyScalar(1 / magnitude);
  return new THREE.ArrowHelper(dir, new THREE.Vector3(...origin), length, color, Math.min(0.18, length * 0.25), Math.min(0.09, length * 0.14));
};

export class PhysicsVectorRenderer {
  constructor(scene) {
    this.scene = scene;
    this.velocityGroup = new THREE.Group();
    this.velocityGroup.name = "observatory-velocity-vectors";
    this.jointGroup = new THREE.Group();
    this.jointGroup.name = "observatory-joint-frames";
    this.contactGroup = new THREE.Group();
    this.contactGroup.name = "observatory-contact-normals";
    scene.add(this.velocityGroup, this.jointGroup, this.contactGroup);
  }

  setVelocityVisible(visible) { this.velocityGroup.visible = Boolean(visible); }
  setJointVisible(visible) { this.jointGroup.visible = Boolean(visible); }
  setContactVisible(visible) { this.contactGroup.visible = Boolean(visible); }

  update(snapshot) {
    this.updateVelocity(snapshot?.bodies || []);
    this.updateJoints(snapshot?.joints || []);
    this.updateContacts(snapshot?.contacts || []);
  }

  updateVelocity(bodies) {
    clearGroup(this.velocityGroup);
    for (const body of bodies) {
      if (!finiteVector(body.position) || !finiteVector(body.linearVelocity)) continue;
      const speed = Math.hypot(...body.linearVelocity);
      if (speed < 1e-3) continue;
      const helper = arrow(body.linearVelocity, body.position, Math.min(2.5, Math.max(0.18, speed * 0.28)), COLORS.velocity);
      if (helper) this.velocityGroup.add(helper);
    }
  }

  updateJoints(joints) {
    clearGroup(this.jointGroup);
    for (const joint of joints) {
      if (!finiteVector(joint.worldAnchor) || !finiteVector(joint.worldAxis)) continue;
      const helper = arrow(joint.worldAxis, joint.worldAnchor, 0.9, COLORS.joint);
      if (helper) this.jointGroup.add(helper);
      const pivot = new THREE.Mesh(
        new THREE.SphereGeometry(0.055, 12, 8),
        new THREE.MeshBasicMaterial({ color: COLORS.joint, depthTest: false })
      );
      pivot.position.fromArray(joint.worldAnchor);
      pivot.renderOrder = 22;
      this.jointGroup.add(pivot);
    }
  }

  updateContacts(contacts) {
    clearGroup(this.contactGroup);
    for (const contact of contacts) {
      if (finiteVector(contact.sourcePosition) && finiteVector(contact.targetPosition)) {
        const geometry = new THREE.BufferGeometry().setFromPoints([
          new THREE.Vector3(...contact.sourcePosition),
          new THREE.Vector3(...contact.targetPosition)
        ]);
        const line = new THREE.Line(
          geometry,
          new THREE.LineBasicMaterial({ color: COLORS.contactPair, transparent: true, opacity: 0.45, depthTest: false })
        );
        line.renderOrder = 20;
        this.contactGroup.add(line);
      }
      if (!finiteVector(contact.anchor) || !finiteVector(contact.normal)) continue;
      const helper = arrow(contact.normal, contact.anchor, 0.7, COLORS.contact);
      if (helper) this.contactGroup.add(helper);
    }
  }

  dispose() {
    clearGroup(this.velocityGroup);
    clearGroup(this.jointGroup);
    clearGroup(this.contactGroup);
    this.scene.remove(this.velocityGroup, this.jointGroup, this.contactGroup);
  }
}
