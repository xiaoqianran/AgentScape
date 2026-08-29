import * as THREE from "three";

const ease = (t) => 1 - Math.pow(1 - Math.min(Math.max(t, 0), 1), 4);

export class CameraRig {
  constructor({ camera, controls }) {
    this.camera = camera;
    this.controls = controls;
    this.active = false;
    this.fromPosition = new THREE.Vector3();
    this.toPosition = new THREE.Vector3();
    this.fromTarget = new THREE.Vector3();
    this.toTarget = new THREE.Vector3();
    this.startedAt = 0;
    this.duration = 620;
  }

  moveTo(position, target, { duration = 620, immediate = false } = {}) {
    this.fromPosition.copy(this.camera.position);
    this.fromTarget.copy(this.controls.target);
    this.toPosition.fromArray(position);
    this.toTarget.fromArray(target);
    this.duration = Math.max(1, duration);
    this.startedAt = performance.now();
    this.active = !immediate;
    if (immediate) {
      this.camera.position.copy(this.toPosition);
      this.controls.target.copy(this.toTarget);
      this.controls.update();
    }
  }

  update(timestamp = performance.now()) {
    if (!this.active) return false;
    const t = Math.min(1, (timestamp - this.startedAt) / this.duration);
    const k = ease(t);
    this.camera.position.lerpVectors(this.fromPosition, this.toPosition, k);
    this.controls.target.lerpVectors(this.fromTarget, this.toTarget, k);
    this.controls.update();
    if (t >= 1) this.active = false;
    return this.active;
  }
}
