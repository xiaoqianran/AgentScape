import { compileInteractionContract } from '../interaction/InteractionContract.js';

const blocked = reason => ({ available: false, reason });
const reasonOf = error => error.details?.reason || error.code || 'CAPABILITY_CHECK_FAILED';

/** Read-through discovery. ObjectStore and PhysicsSystem remain the state owners. */
export function inspectObjectAffordances(runtime, id, actorId = null) {
  if (!runtime.store?.has(id)) return null;
  const record = runtime.store.get(id), manifest = record.manifest;
  const registered = Boolean(runtime.physics?.getPosition(id));
  const held = record.state?.heldBy || runtime.interactions?.isHeld?.(id) || runtime.interactions?.carry?.agentHeld?.has(id);
  let access = { available: null, reason: 'ACTOR_REQUIRED_FOR_REACH_CHECK' };
  if (actorId) {
    if (!runtime.store.has(actorId)) access = blocked('ACTOR_NOT_FOUND');
    else if (runtime.store.get(actorId).manifest.type !== 'agent') access = blocked('ACTOR_NOT_AGENT');
    else if (!registered) access = blocked('TARGET_PHYSICS_UNAVAILABLE');
    else if (!runtime.physics.hasCapability('scene-query')) access = blocked('VISIBILITY_UNAVAILABLE');
    else {
      try {
        const reach = runtime.interactions.interactionStatus(actorId, id);
        access = { available: reach.interactable, reason: reach.interactable ? null : reach.inRange ? 'OCCLUDED' : 'OUT_OF_REACH', distance: reach.distance };
      } catch (error) { access = blocked(reasonOf(error)); }
    }
  }
  const actions = [];
  const add = (action, parameters = {}, extra = {}) => actions.push({ action, parameters, ...access, ...extra });
  // Editor operations are explicitly separate from embodied actions.
  add('inspect', {}, { available: true, reason: null, execution: 'query' });
  add('setTransform', { transform: { type: 'object', required: true } }, {
    available: !held, reason: held ? 'OBJECT_HELD' : null, execution: 'editor'
  });
  if (manifest.actions?.includes('pickup')) {
    let check = {};
    if (actorId && runtime.store.has(actorId)) {
      try { runtime.interactions.assertAgentCarryable(actorId, id); }
      catch (error) { check = blocked(reasonOf(error)); }
    }
    add('pickup', {}, { execution: 'interaction', ...check });
  }
  if (manifest.surfaces?.length) {
    const held = actorId && runtime.interactions?.heldByAgent?.(actorId);
    add('place', { surfaceId: { type: 'string', enum: manifest.surfaces.map(surface => surface.id), required: false } }, {
      execution: 'interaction', ...(!actorId ? {} : !held ? blocked('NOT_HOLDING_OBJECT') : !runtime.store.get(held).manifest.actions?.includes('place') ? blocked('ACTION_UNSUPPORTED') : {})
    });
  }
  for (const contract of compileInteractionContract(manifest).contracts) {
    const partName = contract.target.partName;
    const live = runtime.physics?.getArticulationState?.(id, partName);
    add(contract.action, { partName: { type: 'string', enum: [partName], required: true } }, {
      execution: 'interaction', partName, contract,
      joint: structuredClone(manifest.parts[partName].joint), state: live,
      ...(!['open', 'close'].includes(contract.action) ? blocked('EXECUTOR_UNAVAILABLE') : !live ? blocked('ARTICULATION_PHYSICS_UNAVAILABLE') : {}),
      ...(runtime.interactions.articulationTasks?.has(`${id}:${partName}`) ? blocked('ACTION_IN_PROGRESS') : {})
    });
  }
  for (const [partName, part] of Object.entries(manifest.parts || {})) {
    if (!['revolute', 'prismatic'].includes(part.joint?.type)) continue;
    const action = part.joint.type === 'prismatic' ? 'slide' : 'rotateJoint';
    const capability = runtime.interactions?.manipulationCapability?.(id, action, partName) || blocked('EXECUTOR_UNAVAILABLE');
    const relative = action === 'slide' ? 'distance' : 'angle';
    add(action, { part: { type: 'string', enum: [partName], required: true },
      target: { type: 'number', required: false, alternative:relative, unit: action === 'slide' ? 'meter' : 'radian', limits: structuredClone(part.joint.limits || null) },
      [relative]: {type:'number', required:false, alternative:'target', relative:true, unit:action === 'slide' ? 'meter' : 'radian'} }, {
      execution: 'interaction', partName, joint: structuredClone(part.joint), state:runtime.physics?.getArticulationState?.(id,partName),
      ...(!capability.available ? capability : {}), ...(actorId && runtime.interactions?.heldByAgent?.(actorId) ? blocked('HANDS_FULL') : {})
    });
  }
  if (manifest.physics?.colliders?.length) {
    for (const action of ['push', 'drag', 'rotate']) {
      const capability = runtime.interactions?.manipulationCapability?.(id, action) || blocked('EXECUTOR_UNAVAILABLE');
      const parameters = action === 'rotate' ? { axis:{type:'array',length:3,nonzero:true,required:true}, angle:{type:'number',minimum:-Math.PI,maximum:Math.PI,unit:'radian',required:true}, maxTorque:{type:'number',minimum:0,exclusiveMinimum:true,maximum:1000,default:100,unit:'newton-meter'} }
        : { direction:{type:'array',length:3,nonzero:true,horizontal:true,required:true}, distance:{type:'number',minimum:0,exclusiveMinimum:true,maximum:5,unit:'meter',required:true}, maxForce:{type:'number',minimum:0,exclusiveMinimum:true,maximum:1000,default:100,unit:'newton'} };
      add(action, parameters, { execution:'interaction', ...(!capability.available ? capability : {}),
        ...(actorId && runtime.interactions?.heldByAgent?.(actorId) ? blocked('HANDS_FULL') : {}) });
    }
  }
  return {
    schema: 'agentscape.object-affordances', schemaVersion: 1, id,
    label: manifest.label || manifest.id, kind: manifest.type, source: 'asset',
    position: record.object.position.toArray(), state: structuredClone(record.state || {}),
    physics: { registered, body: manifest.physics?.body || null, currentBody:runtime.physics?.manipulationBody?.(id)?.body ?? null,
      mass: manifest.physics?.mass ?? null, friction: manifest.physics?.friction ?? null,
      colliderCount: manifest.physics?.colliders?.length || 0 },
    actions, evidenceKind: registered ? 'physics-state' : 'visual-state', physicsVerified: false,
    pending: Boolean(runtime.interactions?.physicalTasks?.has(id) || (runtime.interactions?.articulationTasks && [...runtime.interactions.articulationTasks.values()].some(task => task.id === id)))
  };
}
