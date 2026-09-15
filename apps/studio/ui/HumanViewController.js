import * as THREE from 'three';

export const HUMAN_VIEW_MODES = Object.freeze(['orbit', 'first', 'third']);
export const HUMAN_EYE_HEIGHT = 1.62;

// Query-only capsule: it is never spawned as an asset. Production Rapier answers whether the
// human volume fits before the camera is allowed to move there.
export const HUMAN_QUERY_MANIFEST = Object.freeze({
  physics:{ colliders:[ Object.freeze({ shape:'capsule', radius:0.3, halfHeight:0.5, translation:[0,0.82,0] }) ] }
});

// Spawning uses a wider probe so a pose that only just fits against a wall is rejected.
const SPAWN_QUERY_MANIFEST = Object.freeze({
  physics:{ colliders:[ Object.freeze({ shape:'capsule', radius:0.42, halfHeight:0.5, translation:[0,0.92,0] }) ] }
});

const FEET_CLEARANCE = 0.02;
const STEP_HEIGHT = 0.35;
const WALK_SPEED = 3.1;
const RUN_SPEED = 6.2;
const GRAVITY = 9.81;
const LOOK_SENSITIVITY = 0.0026;
const MAX_PITCH = Math.PI / 2 - 0.06;
const MAX_FRAME_SECONDS = 0.05;
const THIRD_PERSON_DISTANCE = 3.2;
const UP = new THREE.Vector3(0, 1, 0);

const KEY_CODES = Object.freeze({
  KeyW:'forward', ArrowUp:'forward',
  KeyS:'back', ArrowDown:'back',
  KeyA:'left', ArrowLeft:'left',
  KeyD:'right', ArrowRight:'right',
  ShiftLeft:'shift', ShiftRight:'shift'
});

const VIEW_BUTTONS = Object.freeze([['orbit','轨道'],['first','第一人称'],['third','第三人称']]);

// A view-only avatar: it carries no manifest and never enters ObjectStore, Physics or Navigation.
function createAvatar() {
  const group = new THREE.Group();
  group.name = '$human-view';
  group.userData.viewOnly = true;
  const material = new THREE.MeshStandardMaterial({ color:0xf0e6cf, roughness:0.72 });
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.3, 1, 6, 14), material);
  body.position.y = 0.82;
  body.castShadow = true;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.19, 20, 14), material);
  head.position.y = 1.62;
  head.castShadow = true;
  const edges = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.CapsuleGeometry(0.3, 1, 4, 14)),
    new THREE.LineBasicMaterial({ color:0x514b3d, transparent:true, opacity:0.45 })
  );
  edges.position.y = 0.82;
  group.add(body, head, edges);
  group.visible = false;
  return { group, material, geometries:[body.geometry, head.geometry, edges.geometry], edgeMaterial: edges.material };
}

// Orbit stays the default; first / third person only take over while a mode is active.
export class HumanViewController {
  constructor({ world, ui = null, windowTarget = globalThis.window, blockLook = null } = {}) {
    const viewport = world?.rendering?.viewport?.();
    if (!viewport) throw new TypeError('HumanViewController requires an initialized RenderingSystem viewport');
    this.world = world;
    this.viewport = viewport;
    this.camera = viewport.camera;
    this.controls = viewport.controls;
    this.element = viewport.element;
    this.windowTarget = windowTarget;
    this.blockLook = typeof blockLook === 'function' ? blockLook : null;
    this.mode = 'orbit';
    this.keys = new Set();
    this.look = null;
    this.lastFrameTime = null;
    this.verticalVelocity = 0;
    this.yaw = 0;
    this.pitch = -0.08;
    this.position = new THREE.Vector3();
    this.eye = new THREE.Vector3(0, HUMAN_EYE_HEIGHT, 0);
    this.orientation = new THREE.Quaternion(0, 0, 0, 1);
    this.manifest = HUMAN_QUERY_MANIFEST;
    this.orbitState = world.rendering.cameraState?.() || null;
    this.avatar = createAvatar();
    world.scene?.add?.(this.avatar.group);
    this.buttons = [];
    this.panel = null;

    this.onPointerDown = (event) => {
      if (this.mode === 'orbit' || event.button !== 0 || this.blockLook?.()) { this.look = null; return; }
      this.look = { x:event.clientX, y:event.clientY, id:event.pointerId };
    };
    this.onPointerMove = (event) => {
      if (!this.look || this.look.id !== event.pointerId) return;
      const dx = event.clientX - this.look.x;
      const dy = event.clientY - this.look.y;
      this.look.x = event.clientX;
      this.look.y = event.clientY;
      this.yaw -= dx * LOOK_SENSITIVITY;
      this.pitch = THREE.MathUtils.clamp(this.pitch - dy * LOOK_SENSITIVITY, -MAX_PITCH, MAX_PITCH);
    };
    this.onPointerUp = (event) => { if (this.look?.id === event.pointerId) this.look = null; };
    this.onPointerCancel = () => { this.look = null; };
    this.onKeyDown = (event) => {
      const key = KEY_CODES[event.code];
      if (!key || event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.target?.matches?.('input, textarea, select')) return;
      this.keys.add(key);
      if (this.mode === 'orbit') return;
      event.preventDefault?.();
    };
    this.onKeyUp = (event) => {
      const key = KEY_CODES[event.code];
      if (key) this.keys.delete(key);
    };
    this.element.addEventListener('pointerdown', this.onPointerDown);
    this.element.addEventListener('pointermove', this.onPointerMove);
    this.element.addEventListener('pointerup', this.onPointerUp);
    this.element.addEventListener('pointercancel', this.onPointerCancel);
    this.windowTarget?.addEventListener?.('keydown', this.onKeyDown);
    this.windowTarget?.addEventListener?.('keyup', this.onKeyUp);
    this.windowTarget?.addEventListener?.('blur', this.onKeyUp);
    if (ui?.viewport) this.mountPanel(ui);
  }

  mountPanel(ui) {
    const panel = document.createElement('div');
    panel.className = 'cabin-views human-views';
    panel.setAttribute('aria-label','视角控制');
    for (const [mode, label] of VIEW_BUTTONS) {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = label;
      button.addEventListener('click', () => this.setMode(mode));
      panel.append(button);
      this.buttons.push({ mode, button });
    }
    const hint = document.createElement('span');
    hint.className = 'human-views-hint';
    hint.textContent = 'WASD 移动 · Shift 加速 · 拖动画面转视角';
    panel.append(hint);
    ui.viewport.append(panel);
    this.panel = panel;
    this.refreshPanel();
  }

  refreshPanel() {
    for (const { mode, button } of this.buttons) button.classList.toggle('active', mode === this.mode);
  }

  setMode(mode) {
    if (!HUMAN_VIEW_MODES.includes(mode) || mode === this.mode) return false;
    const previous = this.mode;
    if (mode === 'orbit') {
      this.controls.enabled = true;
      if (this.orbitState) this.world.rendering.applyCameraState?.(this.orbitState);
      this.look = null;
      this.keys.clear();
      this.avatar.group.visible = false;
    } else {
      if (previous === 'orbit') {
        this.orbitState = this.world.rendering.cameraState?.() || this.orbitState;
        this.placeFromView();
      }
      this.controls.enabled = false;
      this.avatar.group.visible = mode === 'third';
    }
    this.mode = mode;
    this.refreshPanel();
    this.world.events?.emit?.('human-view.mode', { mode });
    return true;
  }

  // Entering a human view starts where the orbit camera was looking, then snaps to the ground.
  placeFromView() {
    const euler = new THREE.Euler().setFromQuaternion(this.camera.quaternion, 'YXZ');
    this.yaw = euler.y;
    this.pitch = THREE.MathUtils.clamp(euler.x, -MAX_PITCH, MAX_PITCH);
    const target = this.controls?.target;
    const [x, z, y] = this.resolveSpawn(target?.x ?? this.camera.position.x, target?.z ?? this.camera.position.z);
    this.position.set(x, y, z);
    this.verticalVelocity = 0;
    this.applyCamera();
  }

  resolveSpawn(x, z) {
    const groundY = this.world.environment?.layout?.groundY ?? 0;
    // The look-at target may sit against a wall, so the wider spawn probe decides first.
    for (const [cx, cz] of [[x, z], [this.camera.position.x, this.camera.position.z], [0, 0]]) {
      const ground = this.groundHeight(cx, cz, groundY);
      const y = ground ?? groundY;
      if (this.clear(cx, cz, y + FEET_CLEARANCE, SPAWN_QUERY_MANIFEST)) return [cx, cz, y];
    }
    return [0, 0, groundY];
  }

  clear(x, z, y, manifest = this.manifest) {
    const physics = this.world.physics;
    if (typeof physics?.manifestPoseClear !== 'function') return true;
    const pose = physics.manifestPoseClear(manifest, [x, y, z]);
    if (!pose?.checked) return true;
    return Boolean(pose.clear);
  }

  groundHeight(x, z, fromY = null) {
    const physics = this.world.physics;
    const fallback = this.world.environment?.layout?.groundY ?? 0;
    if (typeof physics?.raycast !== 'function') return fallback;
    const originY = (fromY ?? this.position.y) + HUMAN_EYE_HEIGHT;
    const hit = physics.raycast([x, originY, z], [x, originY - 6, z]);
    return hit?.point ? hit.point[1] : null;
  }

  update(frameTime = null) {
    const dt = this.delta(frameTime);
    if (this.mode === 'orbit') return false;
    this.integrate(dt);
    this.applyCamera();
    // Another controller may flip the rig back on; the human view owns the camera while active.
    this.controls.enabled = false;
    return true;
  }

  delta(frameTime) {
    const time = Number.isFinite(frameTime) ? frameTime : (this.lastFrameTime ?? 0) + 16.7;
    if (this.lastFrameTime === null) {
      this.lastFrameTime = time;
      return 0;
    }
    const seconds = Math.min(MAX_FRAME_SECONDS, Math.max(0, (time - this.lastFrameTime) / 1000));
    this.lastFrameTime = time;
    return seconds;
  }

  integrate(dt) {
    if (!dt) return;
    const speed = this.keys.has('shift') ? RUN_SPEED : WALK_SPEED;
    const forwardInput = (this.keys.has('forward') ? 1 : 0) - (this.keys.has('back') ? 1 : 0);
    const strafeInput = (this.keys.has('right') ? 1 : 0) - (this.keys.has('left') ? 1 : 0);
    const sin = Math.sin(this.yaw);
    const cos = Math.cos(this.yaw);
    let dx = -sin * forwardInput + cos * strafeInput;
    let dz = -cos * forwardInput - sin * strafeInput;
    const length = Math.hypot(dx, dz);
    if (length > 0) {
      dx = dx / length * speed * dt;
      dz = dz / length * speed * dt;
    }
    this.moveHorizontally(dx, dz);
    this.verticalVelocity = Math.max(-14, this.verticalVelocity - GRAVITY * dt);
    const ground = this.groundHeight(this.position.x, this.position.z);
    if (ground !== null && this.position.y + this.verticalVelocity * dt <= ground + STEP_HEIGHT) {
      this.position.y = ground;
      this.verticalVelocity = 0;
    } else {
      this.position.y = Math.max(-18, this.position.y + this.verticalVelocity * dt);
    }
  }

  moveHorizontally(dx, dz) {
    if (!dx && !dz) return false;
    const feet = this.position.y + FEET_CLEARANCE;
    const step = (x, z, y = feet) => {
      if (!this.clear(x, z, y)) return false;
      this.position.set(x, y, z);
      return true;
    };
    const x = this.position.x;
    const z = this.position.z;
    if (step(x + dx, z + dz)) return false;
    if (dx && step(x + dx, z)) return false;
    if (dz && step(x, z + dz)) return false;
    // Ledge climb: only a small step up is allowed to become a walkable surface.
    return !step(x + dx, z + dz, feet + STEP_HEIGHT);
  }

  applyCamera() {
    this.eye.set(this.position.x, this.position.y + HUMAN_EYE_HEIGHT, this.position.z);
    this.orientation.setFromEuler(new THREE.Euler(this.pitch, this.yaw, 0, 'YXZ'));
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(this.orientation);
    if (this.mode === 'third') {
      const hit = this.world.physics?.raycast?.([this.eye.x, this.eye.y, this.eye.z], [
        this.eye.x - forward.x * THIRD_PERSON_DISTANCE,
        this.eye.y - forward.y * THIRD_PERSON_DISTANCE,
        this.eye.z - forward.z * THIRD_PERSON_DISTANCE
      ]);
      const distance = hit?.point ? Math.max(0.5, hit.distance - 0.3) : THIRD_PERSON_DISTANCE;
      this.camera.position.copy(this.eye).addScaledVector(forward, -distance);
    } else {
      this.camera.position.copy(this.eye);
    }
    this.camera.quaternion.copy(this.orientation);
    this.avatar.group.position.copy(this.position);
    this.avatar.group.quaternion.setFromAxisAngle(UP, this.yaw);
  }

  // The human view pose feeds interaction range so in-world actions use the real viewpoint.
  viewPose() {
    if (this.mode === 'orbit') return null;
    return { position:[...this.eye.toArray()], rotation:[...this.orientation.toArray()] };
  }

  dispose() {
    this.element.removeEventListener('pointerdown', this.onPointerDown);
    this.element.removeEventListener('pointermove', this.onPointerMove);
    this.element.removeEventListener('pointerup', this.onPointerUp);
    this.element.removeEventListener('pointercancel', this.onPointerCancel);
    this.windowTarget?.removeEventListener?.('keydown', this.onKeyDown);
    this.windowTarget?.removeEventListener?.('keyup', this.onKeyUp);
    this.windowTarget?.removeEventListener?.('blur', this.onKeyUp);
    if (this.mode !== 'orbit') this.setMode('orbit');
    this.avatar.group.parent?.remove?.(this.avatar.group);
    for (const geometry of this.avatar.geometries) geometry.dispose?.();
    this.avatar.material.dispose?.();
    this.avatar.edgeMaterial.dispose?.();
    this.panel?.remove?.();
    this.panel = null;
    this.buttons = [];
    this.keys.clear();
  }
}
