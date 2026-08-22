import * as THREE from 'three';
const DEFAULT_CONFIG = Object.freeze({
  cellSize: 0.15,
  cellHeight: 0.1,
  agentRadius: 0.3,
  agentHeight: 1.7,
  maxClimb: 0.3,
  maxSlope: 45,
  maxSnapDistance: 0.75,
  tileSize: 32,
  maxObstacles: 128
});

const round = (value) => Number(value.toFixed(3));
const roundPoint = (point) => [round(point.x), round(point.y), round(point.z)];
const point = (value) => ({ x: value[0], y: value[1], z: value[2] });
const finitePoint = (value) => Array.isArray(value) && value.length === 3 && value.every(Number.isFinite);
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const pathCost = (path) => path.slice(1).reduce((sum, current, index) => sum + distance(path[index], current), 0);

const voxelCeil = (value, cell) => Math.ceil(value / cell - 1e-9);
const voxelFloor = (value, cell) => Math.floor(value / cell + 1e-9);

const recastConfig = ({ cellSize, cellHeight, agentRadius, agentHeight, maxClimb, maxSlope, tileSize, maxObstacles }) => ({
  cs: cellSize,
  ch: cellHeight,
  walkableSlopeAngle: maxSlope,
  walkableHeight: Math.max(3, voxelCeil(agentHeight, cellHeight)),
  walkableClimb: Math.max(0, voxelFloor(maxClimb, cellHeight)),
  walkableRadius: Math.max(0, voxelCeil(agentRadius, cellSize)),
  tileSize,
  maxObstacles
});

const meshArrays = (meshes, mergePositionsAndIndices) => {
  const vertex = new THREE.Vector3();
  const inputs = [];
  for (const mesh of meshes) {
    mesh.updateWorldMatrix(true, false);
    const attribute = mesh.geometry.getAttribute('position');
    if (!attribute || attribute.itemSize !== 3) continue;
    const positions = new Float32Array(attribute.count * 3);
    for (let i = 0; i < attribute.count; i++) {
      vertex.fromBufferAttribute(attribute, i).applyMatrix4(mesh.matrixWorld).toArray(positions, i * 3);
    }
    const sourceIndices = mesh.geometry.getIndex();
    const indices = sourceIndices?.array || Uint32Array.from({ length:attribute.count }, (_, i) => i);
    inputs.push({ positions, indices });
  }
  return mergePositionsAndIndices(inputs);
};

const near = (a, b, epsilon = 0.002) => Math.abs(a - b) <= epsilon;
const sameArray = (a = [], b = [], epsilon) => a.length === b.length && a.every((value, index) => near(value, b[index], epsilon));
const sameObstacle = (a, b) => a?.shape === b?.shape && a?.sourceShape === b?.sourceShape && a?.quality === b?.quality && sameArray(a?.position, b?.position, 0.002) && (
  a?.shape === 'box'
    ? sameArray(a?.halfExtents, b?.halfExtents, 0.002) && near(a?.angle || 0, b?.angle || 0, 0.005)
    : near(a?.radius || 0, b?.radius || 0, 0.002) && near(a?.height || 0, b?.height || 0, 0.002)
);

export class NavigationSystem {
  constructor({ store, physics = null, environmentRoots = [], config = {}, events = null } = {}) {
    this.store = store;
    this.physics = physics;
    this.environmentRoots = [...environmentRoots];
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.navMesh = null;
    this.tileCache = null;
    this.query = null;
    this.obstacles = new Map();
    this.obstacleSyncVersion = 0;
    this.lastObstacleSync = null;
    this.tileCachePending = false;
    this.dirty = true;
    this.revision = 0;
    this.buildVersion = 0;
    this.buildPromise = null;
    this.libraryPromise = null;
    this.lastInvalidation = 'initial';
    this.lastBuild = null;
    this.disposed = false;
    this.interactionOff = events?.on?.('interaction', ({ action, id }) => {
      if (!['move', 'place'].includes(action) || !id || !this.store?.has?.(id)) return;
      this.invalidateIfStatic(this.store.get(id), `interaction:${action}`);
    }) || null;
  }

  isStaticRecord(record) { return record?.manifest?.physics?.body === 'fixed'; }

  invalidate(reason = 'world-changed') {
    this.dirty = true;
    this.revision += 1;
    this.lastInvalidation = reason;
  }

  invalidateIfStatic(record, reason) {
    if (!this.isStaticRecord(record)) return false;
    this.invalidate(reason);
    return true;
  }

  status() {
    return {
      state: !this.query ? (this.lastBuild?.success === false ? 'failed' : 'unbuilt') : this.dirty ? 'dirty' : 'ready',
      dirty: this.dirty,
      buildVersion: this.buildVersion,
      lastInvalidation: this.lastInvalidation,
      config: { ...this.config },
      capabilities: { staticNavMesh:true, dynamicObstacles:Boolean(this.physics?.navigationObstacles), tileCache:true, obstacleSource:'rapier-colliders', synchronization:'query-time' },
      dynamicObstacles:{ tracked:this.obstacles.size, syncVersion:this.obstacleSyncVersion, lastSync:this.lastObstacleSync ? structuredClone(this.lastObstacleSync) : null },
      lastBuild: this.lastBuild ? structuredClone(this.lastBuild) : null
    };
  }

  collectStaticMeshes() {
    const meshes = [];
    const skipped = [];
    const seen = new Set();
    const collect = (root, source, excludedPartNodes = new Set()) => {
      root.updateWorldMatrix?.(true, true);
      root.traverse?.((node) => {
        if (!node.isMesh || seen.has(node) || node.userData?.navigationIgnore) return;
        seen.add(node);
        for (let current = node; current && current !== root.parent; current = current.parent) {
          if (excludedPartNodes.has(current.name)) {
            skipped.push({ source, node:node.name || null, reason:'dynamic-part' });
            return;
          }
          if (current === root) break;
        }
        if (!node.visible || node.isSkinnedMesh || node.isInstancedMesh || !node.geometry?.getAttribute?.('position')) {
          skipped.push({ source, node: node.name || null, reason: node.isSkinnedMesh ? 'skinned' : node.isInstancedMesh ? 'instanced' : 'unsupported' });
          return;
        }
        meshes.push(node);
      });
    };

    this.environmentRoots.forEach((root, index) => collect(root, `environment:${index}`));
    for (const [id, record] of this.store?.entries?.() || []) {
      if (!this.isStaticRecord(record)) continue;
      const excludedPartNodes = new Set(Object.values(record.manifest.parts || {}).map((part) => part.node).filter(Boolean));
      collect(record.object, id, excludedPartNodes);
    }
    return { meshes, skipped };
  }

  async loadLibrary() {
    if (!this.libraryPromise) {
      this.libraryPromise = Promise.all([
        import('@recast-navigation/core'),
        import('@recast-navigation/generators')
      ]).then(async ([core, generators]) => {
        await core.init();
        return { NavMeshQuery: core.NavMeshQuery, generateTileCache: generators.generateTileCache, mergePositionsAndIndices:generators.mergePositionsAndIndices };
      });
    }
    return this.libraryPromise;
  }

  destroyCurrent() {
    this.query?.destroy();
    this.tileCache?.destroy();
    this.navMesh?.destroy();
    this.query = null;
    this.tileCache = null;
    this.navMesh = null;
    this.obstacles.clear();
    this.tileCachePending = false;
  }

  async rebuild() {
    if (this.disposed) return { success:false, code:'NAVIGATION_DISPOSED' };
    const revision = this.revision;
    const startedAt = Date.now();
    const { meshes, skipped } = this.collectStaticMeshes();
    if (!meshes.length) {
      this.destroyCurrent();
      this.lastBuild = { success: false, code: 'NAVMESH_EMPTY', meshCount: 0, skipped, at: new Date().toISOString() };
      return this.lastBuild;
    }

    try {
      const { NavMeshQuery, generateTileCache, mergePositionsAndIndices } = await this.loadLibrary();
      const [positions, indices] = meshArrays(meshes, mergePositionsAndIndices);
      const built = generateTileCache(positions, indices, recastConfig(this.config));
      if (!built.success) {
        this.destroyCurrent();
        this.lastBuild = { success: false, code: 'NAVMESH_BUILD_FAILED', error: built.error || 'Recast build failed', meshCount: meshes.length, skipped, at: new Date().toISOString() };
        return this.lastBuild;
      }
      if (this.disposed || revision !== this.revision) {
        built.tileCache.destroy();
        built.navMesh.destroy();
        return { success: false, code: 'NAVMESH_CHANGED_DURING_BUILD' };
      }

      const query = new NavMeshQuery(built.navMesh);
      this.destroyCurrent();
      this.navMesh = built.navMesh;
      this.tileCache = built.tileCache;
      this.query = query;
      this.dirty = false;
      this.buildVersion += 1;
      this.lastBuild = {
        success: true,
        buildVersion: this.buildVersion,
        meshCount: meshes.length,
        skipped,
        durationMs: Date.now() - startedAt,
        at: new Date().toISOString()
      };
      return this.lastBuild;
    } catch (error) {
      this.destroyCurrent();
      this.lastBuild = { success: false, code: 'NAVMESH_BUILD_FAILED', error: error.message, meshCount: meshes.length, skipped, at: new Date().toISOString() };
      return this.lastBuild;
    }
  }

  async ensureBuilt() {
    if (this.disposed) return { success:false, code:'NAVIGATION_DISPOSED' };
    if (!this.dirty && this.query) return this.lastBuild;
    if (!this.buildPromise) this.buildPromise = this.rebuild().finally(() => { this.buildPromise = null; });
    return this.buildPromise;
  }

  flushTileCache() {
    if (!this.tileCache || !this.navMesh || !this.tileCachePending) return { success:true, updates:0 };
    for (let updates = 1; updates <= 128; updates++) {
      const result = this.tileCache.update(this.navMesh);
      if (!result.success) return { success:false, code:'TILECACHE_UPDATE_FAILED', updates };
      if (result.upToDate) { this.tileCachePending = false; return { success:true, updates }; }
    }
    return { success:false, code:'TILECACHE_UPDATE_INCOMPLETE', updates:128 };
  }

  queueObstacle(descriptor) {
    return descriptor.shape === 'cylinder'
      ? this.tileCache.addCylinderObstacle(point(descriptor.position), descriptor.radius, descriptor.height)
      : this.tileCache.addBoxObstacle(point(descriptor.position), point(descriptor.halfExtents), descriptor.angle || 0);
  }

  reconcileDynamicObstacles() {
    if (!this.physics?.navigationObstacles || !this.tileCache) {
      const result = { success:true, coverage:'none', tracked:0, skipped:[], changed:0, operations:0, updates:0, syncVersion:this.obstacleSyncVersion };
      this.lastObstacleSync = result;
      return result;
    }

    const snapshot = this.physics.navigationObstacles();
    let updates = 0;
    if (this.tileCachePending) {
      const pending = this.flushTileCache();
      updates += pending.updates || 0;
      if (!pending.success) return this.obstacleSyncFailure(pending.code, snapshot, 0, 0, updates);
    }
    const desired = new Map(snapshot.items.map((item) => [item.id, item]));
    let requests = 0;
    const changedIds = new Set();
    let operations = 0;
    const flushIfNeeded = (force = false) => {
      if (!requests || (!force && requests < 48)) return { success:true };
      const flushed = this.flushTileCache();
      updates += flushed.updates || 0;
      if (flushed.success) requests = 0;
      return flushed;
    };
    const request = (operation) => {
      let result = operation();
      if (!result.success) {
        const flushed = flushIfNeeded(true);
        if (!flushed.success) return flushed;
        result = operation();
      }
      if (result.success) { requests += 1; this.tileCachePending = true; }
      return result;
    };

    for (const [id, current] of [...this.obstacles]) {
      const next = desired.get(id);
      if (next && sameObstacle(current.descriptor, next)) continue;
      const removed = request(() => this.tileCache.removeObstacle(current.obstacle));
      if (!removed.success) return this.obstacleSyncFailure('TILECACHE_REMOVE_OBSTACLE_FAILED', snapshot, changedIds.size, operations, updates);
      this.obstacles.delete(id);
      changedIds.add(id); operations += 1;
      const flushed = flushIfNeeded();
      if (!flushed.success) return this.obstacleSyncFailure(flushed.code, snapshot, changedIds.size, operations, updates);
    }

    for (const [id, descriptor] of desired) {
      if (this.obstacles.has(id)) continue;
      const added = request(() => this.queueObstacle(descriptor));
      if (!added.success || !added.obstacle) return this.obstacleSyncFailure('TILECACHE_ADD_OBSTACLE_FAILED', snapshot, changedIds.size, operations, updates);
      this.obstacles.set(id, { obstacle:added.obstacle, descriptor:structuredClone(descriptor) });
      changedIds.add(id); operations += 1;
      const flushed = flushIfNeeded();
      if (!flushed.success) return this.obstacleSyncFailure(flushed.code, snapshot, changedIds.size, operations, updates);
    }

    const flushed = flushIfNeeded(true);
    if (!flushed.success) return this.obstacleSyncFailure(flushed.code, snapshot, changedIds.size, operations, updates);
    if (changedIds.size) this.obstacleSyncVersion += 1;
    const result = {
      success:true,
      coverage:snapshot.skipped.length ? 'partial' : 'complete',
      tracked:this.obstacles.size,
      skipped:structuredClone(snapshot.skipped),
      changed:changedIds.size,
      operations,
      updates,
      syncVersion:this.obstacleSyncVersion
    };
    this.lastObstacleSync = result;
    return result;
  }

  obstacleSyncFailure(code, snapshot, changed, operations, updates) {
    const result = { success:false, code, coverage:'partial', tracked:this.obstacles.size, skipped:structuredClone(snapshot.skipped || []), changed, operations, updates, syncVersion:this.obstacleSyncVersion };
    this.lastObstacleSync = result;
    return result;
  }

  async ensureCurrent() {
    const build = await this.ensureBuilt();
    if (!build?.success || !this.query) return { success:false, code:build?.code || 'NAVMESH_UNAVAILABLE', build };
    const obstacles = this.reconcileDynamicObstacles();
    if (!obstacles.success) return { success:false, code:obstacles.code, build, obstacles };
    return { success:true, build, obstacles };
  }

  queryHalfExtents(maxSnapDistance) {
    const horizontal = Math.max(maxSnapDistance, this.config.agentRadius * 2, this.config.cellSize * 2);
    return { x: horizontal, y: Math.max(this.config.agentHeight, maxSnapDistance), z: horizontal };
  }

  projectPoint(value, maxSnapDistance) {
    const input = point(value);
    const result = this.query.findClosestPoint(input, { halfExtents: this.queryHalfExtents(maxSnapDistance) });
    if (!result.success) return { success: false, reason: 'NAVMESH_QUERY_FAILED' };
    const snapDistance = distance(input, result.point);
    if (snapDistance > maxSnapDistance) return { success: false, reason: 'OFF_NAVMESH', input, point: result.point, snapDistance };
    return { success: true, input, point: result.point, snapDistance };
  }

  async findPath(start, end, { maxSnapDistance = this.config.maxSnapDistance, endTolerance = Math.max(this.config.cellSize * 2, 0.05) } = {}) {
    const scope = this.physics?.navigationObstacles ? 'current' : 'static';
    if (!finitePoint(start) || !finitePoint(end) || !Number.isFinite(maxSnapDistance) || maxSnapDistance < 0) {
      return { reachable:false, scope, reason:'INVALID_INPUT', path:[], cost:null, sameIsland:null };
    }
    const current = await this.ensureCurrent();
    if (!current.success || !this.query) return { reachable:false, scope, reason:current.code, path:[], cost:null, sameIsland:null, build:current.build, dynamicObstacles:current.obstacles || null };
    const build = current.build;

    const projectedStart = this.projectPoint(start, maxSnapDistance);
    if (!projectedStart.success) return this.offMeshResult('START_OFF_NAVMESH', projectedStart, build, scope, current.obstacles);
    const projectedEnd = this.projectPoint(end, maxSnapDistance);
    if (!projectedEnd.success) return this.offMeshResult('END_OFF_NAVMESH', projectedEnd, build, scope, current.obstacles);

    const computed = this.query.computePath(projectedStart.point, projectedEnd.point, { halfExtents: this.queryHalfExtents(maxSnapDistance) });
    const rawPath = computed.path || [];
    const finalDistance = rawPath.length ? distance(rawPath.at(-1), projectedEnd.point) : Infinity;
    const reachable = computed.success && rawPath.length > 0 && finalDistance <= endTolerance;
    const reason = reachable ? null : computed.success && rawPath.length ? 'PARTIAL_PATH' : 'NO_PATH';
    return {
      reachable,
      scope,
      reason,
      sameIsland: reachable ? true : reason === 'PARTIAL_PATH' ? false : null,
      start: { input: [...start], snapped: roundPoint(projectedStart.point), snapDistance: round(projectedStart.snapDistance) },
      end: { input: [...end], snapped: roundPoint(projectedEnd.point), snapDistance: round(projectedEnd.snapDistance) },
      path: rawPath.map(roundPoint),
      cost: rawPath.length ? round(pathCost(rawPath)) : null,
      finalDistance: Number.isFinite(finalDistance) ? round(finalDistance) : null,
      buildVersion: this.buildVersion,
      dynamicObstacles:current.obstacles,
      ...(computed.error ? { error: computed.error.name } : {})
    };
  }

  offMeshResult(reason, projected, build, scope = 'static', dynamicObstacles = null) {
    return {
      reachable: false,
      scope,
      reason,
      sameIsland: null,
      path: [],
      cost: null,
      snapDistance: Number.isFinite(projected.snapDistance) ? round(projected.snapDistance) : null,
      snapped: projected.point ? roundPoint(projected.point) : null,
      buildVersion: build?.buildVersion || this.buildVersion,
      dynamicObstacles
    };
  }

  async canReach(start, end, options) {
    const result = await this.findPath(start, end, options);
    const { path, ...summary } = result;
    return { ...summary, waypointCount: path.length };
  }

  dispose() {
    this.disposed = true;
    this.revision += 1;
    this.interactionOff?.();
    this.interactionOff = null;
    this.destroyCurrent();
    this.dirty = true;
    this.buildPromise = null;
  }
}
