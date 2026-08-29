import * as THREE from 'three';

/**
 * DebugOverlay — 把 Runtime 内部真值画成 3D 线框。
 *
 * 设计约束（对应 ADR-0005 / ADR-0006）：
 * - 单向依赖 Runtime：只读，不写入，Runtime 不知道本层存在。
 * - 不 import World Core 私有实现，只消费公开只读 API 与 Manifest 数据。
 * - 物理能力缺失时（TransformPhysicsBackend 等）自动跳过相关图层，
 *   不画没有真值的几何。
 */

const LAYERS = Object.freeze({
  collider: 'collider',
  joint: 'joint',
  bounds: 'bounds',
  relations: 'relations',
  interaction: 'interaction',
  navmesh: 'navmesh'
});

const COLORS = Object.freeze({
  colliderRoot: 0x4ade80,
  colliderPart: 0x38bdf8,
  colliderEnvironment: 0x64748b,
  jointAxis: 0xfbbf24,
  bounds: 0xa78bfa,
  relationOn: 0xf472b6,
  relationNear: 0x94a3b8,
  relationOther: 0xcbd5e1,
  interaction: 0xfb7185,
  carry: 0x22d3ee,
  navmesh: 0x2dd4bf
});

const disposeObject = (object) => {
  object.traverse((node) => {
    if (node.geometry) node.geometry.dispose();
    if (node.material) {
      if (Array.isArray(node.material)) node.material.forEach((m) => m.dispose());
      else node.material.dispose();
    }
  });
};

/** 按 collider spec 构造线框几何。spec 直接来自 Manifest，不是物理私有对象。 */
function colliderWireframe(spec) {
  const shape = spec?.shape;
  if (shape === 'box' && Array.isArray(spec.halfExtents)) {
    return new THREE.BoxGeometry(...spec.halfExtents.map((v) => v * 2));
  }
  if (shape === 'cylinder' && Number.isFinite(spec.halfHeight) && Number.isFinite(spec.radius)) {
    return new THREE.CylinderGeometry(spec.radius, spec.radius, spec.halfHeight * 2, 20);
  }
  if (shape === 'capsule' && Number.isFinite(spec.halfHeight) && Number.isFinite(spec.radius)) {
    return new THREE.CapsuleGeometry(spec.radius, spec.halfHeight * 2, 6, 12);
  }
  if (shape === 'convexHull' && Array.isArray(spec.vertices) && spec.vertices.length >= 12) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(spec.vertices, 3));
    geometry.computeVertexNormals();
    // convexHull 只给点云；用 EdgesGeometry 保留轮廓，避免显示成实心噪声。
    return new THREE.EdgesGeometry(geometry, 1).attributes.position
      ? new THREE.BufferGeometry().setAttribute(
          'position',
          new THREE.Float32BufferAttribute(new Float32Array(geometry.attributes.position.array), 3)
        )
      : geometry;
  }
  return null;
}

function applyColliderTransform(object, spec) {
  if (Array.isArray(spec.translation)) object.position.fromArray(spec.translation);
  if (Array.isArray(spec.rotation) && spec.rotation.length === 4) object.quaternion.fromArray(spec.rotation);
}

export class DebugOverlay {
  constructor(runtime) {
    this.runtime = runtime;
    this.group = new THREE.Group();
    this.group.name = 'DebugOverlay';
    this.group.renderOrder = 999;
    this.enabled = new Set();
    this.layers = new Map();
    for (const key of Object.keys(LAYERS)) this.layers.set(key, new THREE.Group());
    for (const layer of this.layers.values()) this.group.add(layer);
    this.scene = null;
  }

  /** 挂载到 Runtime scene。必须在 runtime.init() 之后调用。 */
  attach() {
    if (this.scene || !this.runtime?.scene) return this;
    this.scene = this.runtime.scene;
    this.scene.add(this.group);
    this.rebuild();
    return this;
  }

  get availableLayers() {
    const physics = this.runtime?.physics;
    // capability 查询缺失时按不可用处理：宁可禁用图层，也不画没有真值的几何。
    const capability = (name) => {
      if (typeof physics?.hasCapability !== 'function') return false;
      return physics.hasCapability(name) === true;
    };
    return {
      collider: capability('collision'),
      joint: capability('articulated-body'),
      bounds: true,
      relations: Boolean(this.runtime?.sceneGraph),
      interaction: Boolean(this.runtime?.interactions),
      navmesh: Boolean(this.runtime?.navigation)
    };
  }

  isEnabled(layer) { return this.enabled.has(layer); }

  toggle(layer, next = !this.enabled.has(layer)) {
    if (!LAYERS[layer]) return false;
    if (next) this.enabled.add(layer);
    else this.enabled.delete(layer);
    const group = this.layers.get(layer);
    group.visible = next;
    if (next) this.rebuild(layer);
    return next;
  }

  rebuild(layer = null) {
    if (!this.scene) return this;
    for (const key of Object.keys(LAYERS)) {
      if (layer && key !== layer) continue;
      const group = this.layers.get(key);
      disposeObject(group);
      group.clear();
      if (!this.enabled.has(key)) { group.visible = false; continue; }
      group.visible = true;
      this[`build${key[0].toUpperCase()}${key.slice(1)}`](group);
    }
    return this;
  }

  // ── 图层：collider ─────────────────────────────────────────
  buildCollider(group) {
    const store = this.runtime?.store;
    if (!store) return;
    for (const [id, record] of store.list()) {
      const manifest = record.manifest;
      const root = record.object;
      if (!manifest?.physics?.colliders) continue;
      const color = COLORS.colliderRoot;
      for (const spec of manifest.physics.colliders) {
        const geometry = colliderWireframe(spec);
        if (!geometry) continue;
        const line = new THREE.LineSegments(
          new THREE.EdgesGeometry(geometry),
          new THREE.LineBasicMaterial({ color, depthTest: false, transparent: true, opacity: 0.85 })
        );
        geometry.dispose();
        applyColliderTransform(line, spec);
        // collider 定义在 asset 局部空间，随实例世界变换走。
        root.updateWorldMatrix(true, false);
        line.applyMatrix4(root.matrixWorld);
        line.userData.instanceId = id;
        group.add(line);
      }
      // Part collider：关节部件各自拥有碰撞体。
      for (const [partName, part] of Object.entries(manifest.parts || {})) {
        for (const spec of part.physics?.colliders || []) {
          const geometry = colliderWireframe(spec);
          if (!geometry) continue;
          const line = new THREE.LineSegments(
            new THREE.EdgesGeometry(geometry),
            new THREE.LineBasicMaterial({ color: COLORS.colliderPart, depthTest: false, transparent: true, opacity: 0.8 })
          );
          geometry.dispose();
          applyColliderTransform(line, spec);
          const node = root.getObjectByName(part.node);
          if (!node) continue;
          node.updateWorldMatrix(true, false);
          line.applyMatrix4(node.matrixWorld);
          line.userData.instanceId = id;
          line.userData.partName = partName;
          group.add(line);
        }
      }
    }
  }

  // ── 图层：joint axis ───────────────────────────────────────
  buildJoint(group) {
    const store = this.runtime?.store;
    if (!store) return;
    for (const [id, record] of store.list()) {
      const root = record.object;
      for (const [partName, part] of Object.entries(record.manifest?.parts || {})) {
        const joint = part.joint;
        const node = root.getObjectByName(part.node);
        if (!joint || !node) continue;
        node.updateWorldMatrix(true, false);
        const axis = new THREE.Vector3(...(joint.axis || [0, 1, 0])).normalize();
        const length = 0.35;
        const origin = new THREE.Vector3().setFromMatrixPosition(node.matrixWorld);
        const tip = origin.clone().add(axis.clone().multiplyScalar(length));
        const geometry = new THREE.BufferGeometry().setFromPoints([origin, tip]);
        const line = new THREE.Line(
          geometry,
          new THREE.LineBasicMaterial({ color: COLORS.jointAxis, depthTest: false })
        );
        line.userData.instanceId = id;
        line.userData.partName = partName;
        group.add(line);

        const pivot = new THREE.Mesh(
          new THREE.SphereGeometry(0.035, 10, 8),
          new THREE.MeshBasicMaterial({ color: COLORS.jointAxis, depthTest: false, transparent: true, opacity: 0.9 })
        );
        pivot.position.copy(origin);
        group.add(pivot);
      }
    }
  }

  // ── 图层：bounds ───────────────────────────────────────────
  buildBounds(group) {
    const store = this.runtime?.store;
    if (!store) return;
    for (const [id, record] of store.list()) {
      const box = new THREE.Box3().setFromObject(record.object);
      if (box.isEmpty()) continue;
      const helper = new THREE.Box3Helper(box, COLORS.bounds);
      helper.material.depthTest = false;
      helper.material.transparent = true;
      helper.material.opacity = 0.6;
      helper.userData.instanceId = id;
      group.add(helper);
    }
  }

  // ── 图层：spatial relations ────────────────────────────────
  buildRelations(group) {
    const graph = this.runtime?.sceneGraph;
    const store = this.runtime?.store;
    if (!graph || !store) return;
    graph.update?.();
    const centerOf = (id) => {
      // 关系可能悬空（对象已移除但关系尚未清理）；用 has 探测，不触发抛错。
      if (!store.has?.(id)) return null;
      const record = store.get?.(id);
      if (!record) return null;
      const box = new THREE.Box3().setFromObject(record.object);
      return box.isEmpty() ? null : box.getCenter(new THREE.Vector3());
    };
    for (const edge of graph.list()) {
      const a = centerOf(edge.subject);
      const b = centerOf(edge.object);
      if (!a || !b) continue;
      const predicate = String(edge.predicate || '').toUpperCase();
      const color =
        predicate === 'ON' ? COLORS.relationOn
        : predicate === 'NEAR' ? COLORS.relationNear
        : COLORS.relationOther;
      const line = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([a, b]),
        new THREE.LineDashedMaterial({ color, dashSize: 0.12, gapSize: 0.08, depthTest: false, transparent: true, opacity: 0.9 })
      );
      line.computeLineDistances();
      line.userData.relation = `${edge.subject} ${predicate} ${edge.object}`;
      group.add(line);
    }
  }

  // ── 图层：interaction / carry ──────────────────────────────
  buildInteraction(group) {
    const interactions = this.runtime?.interactions;
    const store = this.runtime?.store;
    if (!interactions || !store) return;
    for (const [id, record] of store.list()) {
      if (record.manifest?.type !== 'agent') continue;
      let anchor = null;
      try { anchor = interactions.holdAnchor?.(id); } catch { continue; }
      if (!anchor?.translation) continue;
      // holdAnchor 返回 Manifest 定义（translation/rotation），需换算到世界坐标。
      const actorPosition = this.runtime.physics?.getPosition?.(id)
        || record.object.getWorldPosition(new THREE.Vector3()).toArray();
      const yaw = new THREE.Euler().setFromQuaternion(
        record.object.getWorldQuaternion(new THREE.Quaternion()), 'YXZ'
      ).y;
      const pose = interactions.holdPoseAt?.(actorPosition, yaw, anchor);
      if (!pose) continue;
      const position = new THREE.Vector3().fromArray(pose.position);
      const marker = new THREE.Mesh(
        new THREE.SphereGeometry(0.06, 12, 10),
        new THREE.MeshBasicMaterial({ color: COLORS.carry, depthTest: false, transparent: true, opacity: 0.95 })
      );
      marker.position.copy(position);
      group.add(marker);

      const status = interactions.carryStatus?.(id);
      if (status?.status === 'held' && status.targetId) {
        const target = store.has?.(status.targetId) ? store.get(status.targetId) : null;
        if (target) {
          const to = new THREE.Box3().setFromObject(target.object).getCenter(new THREE.Vector3());
          const line = new THREE.Line(
            new THREE.BufferGeometry().setFromPoints([position, to]),
            new THREE.LineBasicMaterial({ color: COLORS.carry, depthTest: false, transparent: true, opacity: 0.8 })
          );
          line.userData.carried = status.targetId;
          group.add(line);
        }
      }

      // 固定 1.5m 交互距离圈：让"为什么够不着"变成可见事实。
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(1.45, 1.5, 48),
        new THREE.MeshBasicMaterial({ color: COLORS.interaction, side: THREE.DoubleSide, depthTest: false, transparent: true, opacity: 0.5 })
      );
      ring.rotation.x = -Math.PI / 2;
      ring.position.set(position.x, 0.02, position.z);
      group.add(ring);
    }
  }

  // ── 图层：navmesh ──────────────────────────────────────────
  buildNavmesh(group) {
    const navigation = this.runtime?.navigation;
    if (!navigation) return;
    const positions = navigation.debugGeometry?.();
    if (!positions?.length) return;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    const cloud = new THREE.Points(
      geometry,
      new THREE.PointsMaterial({ color: COLORS.navmesh, size: 0.09, depthTest: false, transparent: true, opacity: 0.75 })
    );
    group.add(cloud);

    const status = navigation.status?.();
    if (status) cloud.userData.navStatus = status.state;
  }

  /** 每帧调用：重绘需要跟随物理的图层。 */
  update() {
    if (!this.scene || !this.enabled.size) return;
    // collider / joint / interaction 依赖实时世界变换，必须逐帧重算。
    if (this.enabled.has('collider')) this.rebuild('collider');
    if (this.enabled.has('joint')) this.rebuild('joint');
    if (this.enabled.has('interaction')) this.rebuild('interaction');
    if (this.enabled.has('relations')) this.rebuild('relations');
  }

  dispose() {
    for (const group of this.layers.values()) {
      disposeObject(group);
      group.clear();
    }
    this.layers.clear();
    this.enabled.clear();
    if (this.scene) this.scene.remove(this.group);
    this.scene = null;
  }
}

export { LAYERS as DEBUG_LAYERS, COLORS as DEBUG_COLORS };
