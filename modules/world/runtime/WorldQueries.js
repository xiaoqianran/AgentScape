import { composeObservedNearPlacement } from '../compiler/WorldComposer.js';
import { listObservedEntities, resolveObservedEntity } from './ObservedEntity.js';
import { uniformScaleValue } from './ObjectTransform.js';

const INTERACTABLE_MANIFEST_ACTIONS = new Set([
  'pickup', 'drop', 'place', 'open', 'close', 'read', 'write',
  'turn_on', 'turn_off', 'pull_out', 'return', 'push', 'pull', 'toggle'
]);
const round3 = (value) => Number(value.toFixed(3));
const vec3Round = (value) => Array.isArray(value) ? value.map(round3) : null;
const horizontalAndVerticalDistance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

function objectWorldPosition(object) {
  if (!object) return null;
  if (object.isObject3D) {
    object.updateWorldMatrix?.(true, false);
    const elements = object.matrixWorld?.elements;
    if (Array.isArray(elements) || ArrayBuffer.isView(elements)) {
      return [elements[12], elements[13], elements[14]];
    }
    const local = object.position;
    return local ? [local.x, local.y, local.z] : null;
  }
  if (Array.isArray(object.position) && object.position.length === 3) return [...object.position];
  return null;
}

function nativeInteractionEvidence(item, { feet, radius, catalog } = {}) {
  const position = objectWorldPosition(item?.object);
  const distance = position && feet ? horizontalAndVerticalDistance(position, feet) : null;
  if (Number.isFinite(distance) && distance > radius) return null;
  const contractId = item?.contractId || null;
  return {
    id: item.id,
    label: item.label || item.object?.name || item.id,
    contractId,
    kind: contractId ? 'affordance-linked' : 'native-scene',
    // formal contract → executeWorldAction；纯原生 Three.js 交互 → activateEnvironmentInteract
    executeVia: contractId ? 'executeWorldAction' : 'activateEnvironmentInteract',
    verification: contractId ? 'runtime-contract' : 'native-provisional',
    distance: Number.isFinite(distance) ? round3(distance) : null,
    position: vec3Round(position),
    group: catalog?.groupOf?.(item) || null,
    zone: typeof catalog?.labelOf === 'function' ? catalog.labelOf(item, { y: position?.[1] ?? 0 }) : null,
    source: 'environment.interactions'
  };
}

function partActionEvidence(manifest) {
  const evidence = [];
  for (const [partName, part] of Object.entries(manifest?.parts || {})) {
    for (const action of part?.actions || []) {
      if (Number.isFinite(part?.targets?.[action])) evidence.push({ partName, action, target: part.targets[action] });
    }
  }
  return evidence;
}

export class WorldQueries {
  constructor(runtime) {
    this.runtime = runtime;
  }

  hasObject(id) { return this.runtime.observation?.hasObject?.(id) ?? Boolean(id && this.runtime.store.has(id)); }
  getObjectInfo(id) {
    const record = this.runtime.store.get(id);
    return {
      id,
      asset:record.assetId,
      type:record.manifest.type,
      position:record.object.position.toArray().map((value) => Number(value.toFixed(3))),
      rotation:record.object.rotation.toArray().slice(0, 3).map((value) => Number((value * 180 / Math.PI).toFixed(1))),
      scale:Number(uniformScaleValue(record.object.scale.toArray()).toFixed(3)),
      actions:[...record.manifest.actions]
    };
  }
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

  listInteractablesNearMe({ actorId = null, radius = 3 } = {}) {
    const runtime = this.runtime;
    const id = actorId;
    const limitRadius = Number.isFinite(radius) && radius > 0 ? Math.min(20, radius) : 3;
    if (!id) return { status:'actor-required', schema:'agentscape.interactables-near-me.v1' };

    const entries = runtime.store?.list?.() || [];
    const actorRecord = entries.find(([key]) => key === id)?.[1]
      || (runtime.store?.has?.(id) ? runtime.store.get(id) : null);
    if (!actorRecord) {
      return { status:'actor-not-found', schema:'agentscape.interactables-near-me.v1', actorId:id };
    }

    const feet = runtime.physics?.getPosition?.(id) || actorRecord.object?.position?.toArray?.() || null;
    let nearby = [];
    try {
      nearby = runtime.spatial?.findNearby?.(id, limitRadius) || [];
    } catch {
      nearby = [];
    }
    const nearbyMap = new Map(nearby.map((entry) => [entry.id, entry]));

    const objects = [];
    for (const [objectId, record] of entries) {
      if (objectId === id) continue;
      const nearbyEntry = nearbyMap.get(objectId);
      const position = runtime.physics?.getPosition?.(objectId) || record.object?.position?.toArray?.() || null;
      let distance = Number.isFinite(nearbyEntry?.distance)
        ? nearbyEntry.distance
        : (position && feet ? horizontalAndVerticalDistance(position, feet) : null);
      if (distance == null) {
        if (!nearbyMap.has(objectId)) continue;
        distance = null;
      } else if (distance > limitRadius) {
        continue;
      }
      const manifest = record.manifest || {};
      const actions = [...(manifest.actions || [])];
      const surfaces = (manifest.surfaces || []).map((surface) => surface?.id).filter(Boolean);
      const partActions = partActionEvidence(manifest);
      const interactiveActions = actions.filter((action) => INTERACTABLE_MANIFEST_ACTIONS.has(action));
      const heldBy = record.state?.heldBy || null;
      const canPlaceOnto = surfaces.length > 0;
      const interactable = interactiveActions.length > 0 || partActions.length > 0 || canPlaceOnto;
      objects.push({
        id: objectId,
        asset: record.assetId || manifest.id || null,
        label: manifest.label || record.object?.name || record.assetId || objectId,
        type: manifest.type || null,
        distance: Number.isFinite(distance) ? round3(distance) : null,
        position: vec3Round(position),
        actions,
        interactiveActions,
        partActions,
        surfaces,
        canPlaceOnto,
        interactable,
        heldBy
      });
    }
    objects.sort((left, right) => (left.distance ?? Infinity) - (right.distance ?? Infinity));

    const affordanceResult = runtime.affordances?.list?.({ actorId:id, limit:50 }) || { entities:[] };
    const affordances = [];
    for (const entry of affordanceResult.entities || []) {
      const actionDistance = (entry.actions || [])
        .map((action) => action?.distance)
        .filter(Number.isFinite)
        .sort((a, b) => a - b)[0];
      let distance = actionDistance;
      if (!Number.isFinite(distance) && Array.isArray(entry.position) && feet) {
        distance = horizontalAndVerticalDistance(entry.position, feet);
      }
      if (Number.isFinite(distance) && distance > limitRadius) continue;
      const actionList = (entry.actions || []).map((action) => ({
        action: action.action,
        available: action.available !== false,
        reason: action.reason || null,
        distance: Number.isFinite(action.distance) ? round3(action.distance) : null
      }));
      affordances.push({
        id: entry.id,
        label: entry.label,
        kind: entry.kind,
        distance: Number.isFinite(distance) ? round3(distance) : null,
        position: vec3Round(entry.position),
        actions: actionList,
        available: actionList.some((action) => action.available),
        evidenceKind: entry.evidenceKind || null,
        physicsVerified: entry.physicsVerified === true
      });
    }
    affordances.sort((left, right) => (left.distance ?? Infinity) - (right.distance ?? Infinity));

    // 环境原生 Three.js 交互（如魔女小屋门/窗/座椅/摆件）：来自 environment.interactions，
    // 不依赖 ObjectStore 资产 Manifest。有 contractId 的与 WorldAffordance 对齐；无契约的标为 native-provisional。
    const nativeInteractables = [];
    const catalog = runtime.environment?.catalog || null;
    for (const item of runtime.environment?.interactions || []) {
      if (!item?.id || typeof item.activate !== 'function') continue;
      const evidence = nativeInteractionEvidence(item, { feet, radius: limitRadius, catalog });
      if (evidence) nativeInteractables.push(evidence);
    }
    nativeInteractables.sort((left, right) => (left.distance ?? Infinity) - (right.distance ?? Infinity));

    const interactables = objects.filter((entry) => entry.interactable);
    return {
      schema: 'agentscape.interactables-near-me.v1',
      status: 'interactables-near-me',
      actorId: id,
      radius: limitRadius,
      position: vec3Round(feet),
      environmentId: runtime.environment?.id || null,
      objects,
      interactables,
      affordances,
      nativeInteractables,
      summary: {
        objectCount: objects.length,
        interactableCount: interactables.length,
        affordanceCount: affordances.length,
        inReachAffordanceCount: affordances.filter((entry) => entry.available).length,
        nativeInteractableCount: nativeInteractables.length,
        nativeContractLinkedCount: nativeInteractables.filter((entry) => entry.contractId).length,
        nativeOnlyCount: nativeInteractables.filter((entry) => !entry.contractId).length
      }
    };
  }

  listEnvironmentInteractables({ actorId = null, radius = 20 } = {}) {
    const runtime = this.runtime;
    const limitRadius = Number.isFinite(radius) && radius > 0 ? Math.min(20, radius) : 20;
    const id = actorId;
    const record = id && (runtime.store?.has?.(id) || runtime.store?.list?.().some(([key]) => key === id))
      ? (runtime.store?.has?.(id) ? runtime.store.get(id) : runtime.store.list().find(([key]) => key === id)?.[1])
      : null;
    const feet = (id && runtime.physics?.getPosition?.(id)) || record?.object?.position?.toArray?.() || null;
    const catalog = runtime.environment?.catalog || null;
    const items = [];
    for (const item of runtime.environment?.interactions || []) {
      if (!item?.id || typeof item.activate !== 'function') continue;
      const evidence = nativeInteractionEvidence(item, { feet, radius: limitRadius, catalog });
      if (evidence) items.push(evidence);
    }
    items.sort((left, right) => (left.distance ?? Infinity) - (right.distance ?? Infinity));
    return {
      schema: 'agentscape.environment-interactables.v1',
      status: 'environment-interactables',
      environmentId: runtime.environment?.id || null,
      actorId: id,
      radius: limitRadius,
      position: vec3Round(feet),
      items,
      summary: {
        count: items.length,
        contractLinkedCount: items.filter((entry) => entry.contractId).length,
        nativeOnlyCount: items.filter((entry) => !entry.contractId).length
      }
    };
  }
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
    const manifest = this.runtime.assetModule.getManifest(assetId);
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
