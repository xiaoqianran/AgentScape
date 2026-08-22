import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { acceleratedRaycast, computeBoundsTree, disposeBoundsTree } from 'three-mesh-bvh';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { AssetRegistry } from './AssetRegistry.js';

THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;
THREE.Mesh.prototype.raycast = acceleratedRaycast;

export class World {
  constructor(container, onEvent = () => {}) {
    this.container = container;
    this.onEvent = onEvent;
    this.registry = new AssetRegistry();
    this.objects = new Map();
    this.physics = new Map();
    this.heldId = null;
    this.clock = new THREE.Clock();
  }

  async init() {
    await RAPIER.init();
    this.rapier = new RAPIER.World({ x: 0, y: -9.81, z: 0 });

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0b1020);
    this.scene.fog = new THREE.Fog(0x0b1020, 12, 28);

    this.camera = new THREE.PerspectiveCamera(48, 1, 0.05, 100);
    this.camera.position.set(5.2, 4.2, 6.2);

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.container.appendChild(this.renderer.domElement);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.target.set(0, 0.9, 0);
    this.controls.enableDamping = true;

    this.scene.add(new THREE.HemisphereLight(0xd9e8ff, 0x252c3b, 2.2));
    const key = new THREE.DirectionalLight(0xffffff, 3.5);
    key.position.set(4, 7, 3);
    key.castShadow = true;
    this.scene.add(key);

    this.addRoom();
    this.handleResize = () => this.resize();
    window.addEventListener('resize', this.handleResize);
    this.resize();
    this.animate();
  }

  addRoom() {
    const floor = new THREE.Mesh(
      new THREE.BoxGeometry(10, 0.2, 8),
      new THREE.MeshStandardMaterial({ color: 0x20283a, roughness: 0.92 })
    );
    floor.position.y = -0.1;
    floor.receiveShadow = true;
    this.scene.add(floor);
    const body = this.rapier.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(0, -0.1, 0));
    this.rapier.createCollider(RAPIER.ColliderDesc.cuboid(5, 0.1, 4), body);

    const grid = new THREE.GridHelper(10, 20, 0x526077, 0x30394d);
    grid.position.y = 0.003;
    this.scene.add(grid);
  }

  async spawnAsset(assetId, position = [0, 0, 0], instanceId = `${assetId}_${Date.now()}`) {
    const object = await this.registry.create(assetId);
    object.position.fromArray(position);
    object.userData.instanceId = instanceId;
    this.scene.add(object);
    this.objects.set(instanceId, object);
    this.addPhysics(instanceId, assetId, object);
    this.onEvent(`spawn ${instanceId}`);
    return instanceId;
  }

  addPhysics(instanceId, assetId, object) {
    const p = object.position;
    if (assetId === 'cup') {
      const body = this.rapier.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(p.x, p.y + 0.16, p.z));
      const collider = this.rapier.createCollider(RAPIER.ColliderDesc.cylinder(0.16, 0.15).setMass(0.3), body);
      this.physics.set(instanceId, { body, collider, yOffset: -0.16 });
    } else if (assetId === 'table') {
      const body = this.rapier.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(p.x, p.y, p.z));
      this.rapier.createCollider(RAPIER.ColliderDesc.cuboid(1.2, 0.08, 0.625).setTranslation(0, 1, 0), body);
      for (const x of [-1.02, 1.02]) for (const z of [-0.46, 0.46]) {
        this.rapier.createCollider(RAPIER.ColliderDesc.cuboid(0.07, 0.47, 0.07).setTranslation(x, 0.47, z), body);
      }
      this.physics.set(instanceId, { body, yOffset: 0 });
    } else if (assetId === 'cabinet') {
      const body = this.rapier.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(p.x, p.y + 1, p.z));
      this.rapier.createCollider(RAPIER.ColliderDesc.cuboid(0.85, 1, 0.36), body);
      this.physics.set(instanceId, { body, yOffset: -1 });
    }
  }

  listObjects() {
    return [...this.objects.entries()].map(([id, o]) => ({
      id,
      asset: o.userData.assetId,
      position: o.position.toArray().map(v => Number(v.toFixed(2))),
      actions: o.userData.behavior?.actions || []
    }));
  }

  moveObject(id, position) {
    const object = this.require(id);
    object.position.fromArray(position);
    const physics = this.physics.get(id);
    if (physics?.body) {
      const y = position[1] - (physics.yOffset || 0);
      physics.body.setTranslation({ x: position[0], y, z: position[2] }, true);
      physics.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    }
    this.onEvent(`move ${id} → [${position.join(', ')}]`);
  }

  pickup(id) {
    const object = this.require(id);
    if (!object.userData.behavior?.actions?.includes('pickup')) throw new Error(`${id} is not pickupable`);
    this.heldId = id;
    const body = this.physics.get(id)?.body;
    if (body) body.setBodyType(RAPIER.RigidBodyType.KinematicPositionBased, true);
    this.onEvent(`pickup ${id}`);
  }

  drop(id = this.heldId) {
    if (!id) return;
    const body = this.physics.get(id)?.body;
    if (body) body.setBodyType(RAPIER.RigidBodyType.Dynamic, true);
    this.heldId = null;
    this.onEvent(`drop ${id}`);
  }

  place(id, targetId) {
    const target = this.require(targetId);
    const targetAsset = target.userData.assetId;
    const top = targetAsset === 'table' ? 1.1 : 2.2;
    this.pickup(id);
    this.moveObject(id, [target.position.x, target.position.y + top, target.position.z]);
    this.drop(id);
    this.onEvent(`place ${id} on ${targetId}`);
  }

  open(id) {
    const object = this.require(id);
    if (!object.userData.behavior?.actions?.includes('open')) throw new Error(`${id} is not openable`);
    object.userData.targetDoorAngle = -1.35;
    this.onEvent(`open ${id}`);
  }

  close(id) {
    const object = this.require(id);
    object.userData.targetDoorAngle = 0;
    this.onEvent(`close ${id}`);
  }

  require(id) {
    const object = this.objects.get(id);
    if (!object) throw new Error(`Object not found: ${id}`);
    return object;
  }

  update() {
    const dt = Math.min(this.clock.getDelta(), 1 / 30);
    this.rapier.timestep = dt;
    this.rapier.step();

    for (const [id, entry] of this.physics) {
      const object = this.objects.get(id);
      if (!object || !entry.body || entry.body.isFixed()) continue;
      const p = entry.body.translation();
      object.position.set(p.x, p.y + (entry.yOffset || 0), p.z);
      const q = entry.body.rotation();
      object.quaternion.set(q.x, q.y, q.z, q.w);
    }

    if (this.heldId) {
      const object = this.objects.get(this.heldId);
      const target = new THREE.Vector3(0, 0, -1.6).applyQuaternion(this.camera.quaternion).add(this.camera.position);
      const body = this.physics.get(this.heldId)?.body;
      if (body) body.setNextKinematicTranslation(target);
      object.position.copy(target);
    }

    for (const object of this.objects.values()) {
      const hinge = object.userData.doorHinge;
      if (!hinge || object.userData.targetDoorAngle == null) continue;
      hinge.rotation.y = THREE.MathUtils.lerp(hinge.rotation.y, object.userData.targetDoorAngle, Math.min(1, dt * 6));
    }
  }

  animate = () => {
    requestAnimationFrame(this.animate);
    this.update();
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  };

  resize() {
    const { clientWidth: w, clientHeight: h } = this.container;
    if (!w || !h) return;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h, false);
  }
}
