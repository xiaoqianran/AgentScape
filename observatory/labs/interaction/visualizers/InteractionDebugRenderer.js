import * as THREE from "three";
import {
  clearVisualGroup,
  createInstrumentLine,
  createInstrumentMarker,
  createInstrumentSurface
} from "../../../visual/DebugVisualPrimitives.js";

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
    clearVisualGroup(this.losGroup);
    const eye = reach?.lineOfSight?.eye;
    const aim = reach?.lineOfSight?.aim;
    if (!Array.isArray(eye) || !Array.isArray(aim)) return;
    const tone = reach.visible ? "pass" : "fail";
    this.losGroup.add(createInstrumentLine([eye, aim], tone, { opacity: 0.84, dashed: !reach.visible }));
    this.losGroup.add(createInstrumentMarker(eye, "info", { radius: 0.042, ring: false }));
    this.losGroup.add(createInstrumentMarker(aim, "warn", { radius: 0.045 }));

    const hit = reach.lineOfSight?.hit;
    if (hit && Number.isFinite(hit.distance)) {
      const direction = new THREE.Vector3(...aim).sub(new THREE.Vector3(...eye)).normalize();
      const point = new THREE.Vector3(...eye).addScaledVector(direction, hit.distance);
      this.losGroup.add(createInstrumentMarker(point.toArray(), tone, { radius: 0.058 }));
    }
  }

  updateSupport(surface, support) {
    clearVisualGroup(this.supportGroup);
    if (!surface?.center || !surface?.size) return;
    this.supportGroup.add(createInstrumentSurface(
      surface.center,
      surface.size,
      support?.on ? "pass" : "warn",
      { opacity: support?.on ? 0.1 : 0.075 }
    ));
  }

  updateState(snapshot) {
    clearVisualGroup(this.stateGroup);
    const heldId = snapshot?.held?.human;
    if (!heldId) return;
    const body = snapshot?.physics?.bodies?.find((item) => item.objectId === heldId);
    if (!body?.position) return;
    this.stateGroup.add(createInstrumentMarker(body.position, "warn", { radius: 0.095 }));
  }

  dispose() {
    clearVisualGroup(this.losGroup);
    clearVisualGroup(this.supportGroup);
    clearVisualGroup(this.stateGroup);
    this.scene.remove(this.losGroup, this.supportGroup, this.stateGroup);
  }
}
