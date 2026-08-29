import * as THREE from "three";
import {
  clearVisualGroup,
  createInstrumentArrow,
  createInstrumentLine,
  createInstrumentMarker
} from "../../../visual/DebugVisualPrimitives.js";

const finiteVector = (value, size = 3) => Array.isArray(value)
  && value.length >= size
  && value.slice(0, size).every(Number.isFinite);

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
    clearVisualGroup(this.velocityGroup);
    for (const body of bodies) {
      if (!finiteVector(body.position) || !finiteVector(body.linearVelocity)) continue;
      const speed = Math.hypot(...body.linearVelocity);
      if (speed < 1e-3) continue;
      const helper = createInstrumentArrow(
        body.linearVelocity,
        body.position,
        Math.min(2.4, Math.max(0.18, speed * 0.28)),
        "info"
      );
      if (helper) this.velocityGroup.add(helper);
    }
  }

  updateJoints(joints) {
    clearVisualGroup(this.jointGroup);
    for (const joint of joints) {
      if (!finiteVector(joint.worldAnchor) || !finiteVector(joint.worldAxis)) continue;
      const helper = createInstrumentArrow(joint.worldAxis, joint.worldAnchor, 0.86, "warn");
      if (helper) this.jointGroup.add(helper);
      this.jointGroup.add(createInstrumentMarker(joint.worldAnchor, "warn", { radius: 0.045 }));
    }
  }

  updateContacts(contacts) {
    clearVisualGroup(this.contactGroup);
    for (const contact of contacts) {
      if (finiteVector(contact.sourcePosition) && finiteVector(contact.targetPosition)) {
        this.contactGroup.add(createInstrumentLine(
          [contact.sourcePosition, contact.targetPosition],
          "muted",
          { opacity: 0.42, dashed: true }
        ));
      }
      if (!finiteVector(contact.anchor) || !finiteVector(contact.normal)) continue;
      this.contactGroup.add(createInstrumentMarker(contact.anchor, "fail", { radius: 0.045 }));
      const helper = createInstrumentArrow(contact.normal, contact.anchor, 0.66, "fail");
      if (helper) this.contactGroup.add(helper);
    }
  }

  dispose() {
    clearVisualGroup(this.velocityGroup);
    clearVisualGroup(this.jointGroup);
    clearVisualGroup(this.contactGroup);
    this.scene.remove(this.velocityGroup, this.jointGroup, this.contactGroup);
  }
}
