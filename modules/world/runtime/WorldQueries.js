import { composeObservedNearPlacement } from '../compiler/WorldComposer.js';
import { listObservedEntities, resolveObservedEntity } from './ObservedEntity.js';

export class WorldQueries {
  constructor(runtime) {
    this.runtime = runtime;
  }

  hasObject(id) { return this.runtime.observation?.hasObject?.(id) ?? Boolean(id && this.runtime.store.has(id)); }
  getObjectInfo(id) { return this.runtime.getObjectInfo(id); }
  listObjects() {
    return this.runtime.store.list().map(([id, record]) => ({
      id,
      asset:record.assetId,
      type:record.manifest?.type ?? null,
      label:record.manifest?.label || record.object?.name || record.assetId || id,
      position:record.object?.position?.toArray?.().map((value) => Number(value.toFixed(2))) || null,
      actions:[...(record.manifest?.actions || [])],
      surfaces:(record.manifest?.surfaces || []).map((surface) => surface.id).filter(Boolean)
    }));
  }

  getBounds(id) { return this.runtime.spatial.getBounds(id); }
  findNearby(id, radius = 2) { return this.runtime.spatial.findNearby(id, radius); }
  raycast(origin, direction, maxDistance = 100) { return this.runtime.spatial.raycast(origin, direction, maxDistance); }
  overlaps(id, { ignore = [], margin = 0.01 } = {}) { return this.runtime.spatial.overlappingIds(id, { ignore, margin }); }

  findSupportSurface(targetId, surfaceId) {
    const surface = this.runtime.spatial.getSupportSurface(targetId, surfaceId);
    return surface ? { ...surface, center: surface.center.toArray().map((value) => Number(value.toFixed(3))) } : null;
  }

  findFreeSpace(id, targetId, { surfaceId, clearance } = {}) {
    return this.runtime.spatial.findFreeSpace(id, targetId, { surfaceId, clearance })?.toArray() ?? null;
  }
  supportGeometry(id, targetId, options = {}) { return this.runtime.spatial.supportGeometry(id, targetId, options); }

  canReach(start, end, options = {}) { return this.runtime.navigation.canReach(start, end, options); }
  findPath(start, end, options = {}) { return this.runtime.navigation.findPath(start, end, options); }
  suggestNavigationActions(start, end, options = {}) { return this.runtime.navigation.suggestActions(start, end, options); }
  navigationStatus() { return this.runtime.navigation.status(); }
  locomotionStatus(id) { return this.runtime.locomotion.status(id); }
  findInteractionPose(actorId, targetId, options = {}) { return this.runtime.interactions.findInteractionPose(actorId, targetId, options); }
  articulationStatus(id, partName = null) { return this.runtime.interactions.articulationStatus(id, partName); }
  carryStatus(actorId) { return this.runtime.interactions.carryStatus(actorId); }

  listAffordances(options = {}) { return this.runtime.affordances.list(options); }
  inspectAffordance(targetId, options = {}) { return this.runtime.affordances.inspect(targetId, options); }

  recoveryContacts(targetId, partName = null) { return this.runtime.recovery.contacts(targetId, partName); }
  findRecoveryCleanupPlan(actorId, targetId, options = {}) {
    return this.runtime.interactions.findRecoveryCleanupPlan(actorId, targetId, options);
  }

  validateWorld() { return this.runtime.validator.run(); }

  observedEntity(id) {
    return resolveObservedEntity(this.runtime.sceneGraph, { id }).entity;
  }

  listObservedEntities({ label = '' } = {}) {
    const normalized = typeof label === 'string' ? label.trim().toLocaleLowerCase() : '';
    return listObservedEntities(this.runtime.sceneGraph, { label:normalized });
  }

  planAssetNearObservedEntity(assetId, id, { distance, maxDistance } = {}) {
    const observed = this.observedEntity(id);
    if (!observed) return { status:'observed-entity-missing', id };
    const manifest = this.runtime.assetRegistry.getManifest(assetId);
    const result = composeObservedNearPlacement(manifest, observed, {
      layout:this.runtime.environment?.layout,
      poseClear:(candidate, position) => this.runtime.physics.checkManifestPose(candidate, position),
      distance,
      maxDistance
    });
    const status = result.checked ? 'placement-ready' : 'placement-rejected';
    return { ...result, status, assetId, observedEntityId:observed.id, observationId:observed.observationId };
  }

  async findObservedEntityApproach(id, start, { maxSnapDistance } = {}) {
    const observed = this.observedEntity(id);
    if (!observed) return { status:'observed-entity-missing', id };
    const center = observed.localization?.kind === 'point-scale' ? observed.localization.center : observed.center;
    if (!Array.isArray(center) || center.length !== 3 || !center.every(Number.isFinite)) {
      return { status:'approach-unavailable', id:observed.id, reason:'LOCALIZATION_UNAVAILABLE' };
    }
    const scale = Number.isFinite(observed.localization?.scale) ? observed.localization.scale : 0;
    const snapDistance = Number.isFinite(maxSnapDistance) ? maxSnapDistance : Math.max(.75, Math.min(2, scale + .75));
    const route = await this.runtime.navigation.findPath(start, center, { maxSnapDistance:snapDistance });
    if (!route.reachable) {
      return { status:'approach-unreachable', id:observed.id, observationId:observed.observationId, targetCenter:[...center], maxSnapDistance:snapDistance, route };
    }
    const approach = route.end?.snapped || route.path?.at?.(-1) || null;
    const standoffDistance = Array.isArray(approach)
      ? Number(Math.hypot(approach[0]-center[0], approach[1]-center[1], approach[2]-center[2]).toFixed(3))
      : null;
    return { status:'approach-ready', id:observed.id, observationId:observed.observationId, targetCenter:[...center], approach, maxSnapDistance:snapDistance, standoffDistance, route };
  }

  listRelations(filter = {}) {
    this.runtime.sceneGraph.update();
    return this.runtime.sceneGraph.list(filter);
  }

  describeObjectRelations(id) {
    this.runtime.sceneGraph.update();
    return this.runtime.sceneGraph.describe(id);
  }
}
