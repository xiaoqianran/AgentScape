// A read-only semantic projection. State and geometry remain owned by their providers.
import { inspectNativePhysics } from './NativePhysicsState.js';
import { nativePhysicalTarget,nativeSupportContacts } from '../interaction/NativePhysicalTarget.js';
const spatialPredicates = new Set(['ON', 'NEAR', 'INSIDE', 'CONTAINS', 'SUPPORTS']);

function recordFor(runtime, id) {
  if (!runtime?.store?.get || runtime.store.has?.(id) === false) return null;
  try { return runtime.store.get(id) || null; }
  catch { return null; }
}

function unknown(base, reason) { return { ...base, status:'unknown', reason }; }

/** Mixed/native ON uses current solver contact, not a historical place receipt. */
function physicalSupportFact(runtime,subject,target,surfaceId){
  const nativeSubject=nativePhysicalTarget(runtime.entities,runtime.physics,subject);
  const nativeTarget=nativePhysicalTarget(runtime.entities,runtime.physics,target);
  const a=nativeSubject||recordFor(runtime,subject),b=nativeTarget||recordFor(runtime,target);
  if(!a||!b||a.active===false||b.active===false||!runtime.physics?.getPosition(subject)||!runtime.physics?.getPosition(target))
    return {truth:'unknown',reason:'SUPPORT_PHYSICS_UNAVAILABLE'};
  if(a.state?.heldBy)return {truth:'false',reason:'OBJECT_HELD'};
  if(!runtime.physics.hasCapability?.('scene-query'))return {truth:'unknown',reason:'SUPPORT_PHYSICS_UNAVAILABLE'};
  const geometry=runtime.spatial.supportGeometry(subject,target,{surfaceId,tolerance:.03});
  if(!geometry.supported)return {truth:'false',reason:geometry.reason||'SUPPORT_GEOMETRY_MISMATCH'};
  const contacts=nativeSupportContacts(runtime.physics,subject,target);
  const motion=runtime.physics.getMotion(subject);
  if(!motion||!Number.isFinite(motion.linearSpeed)||!Number.isFinite(motion.angularSpeed))return {truth:'unknown',reason:'SUPPORT_MOTION_UNAVAILABLE'};
  if(!contacts.length||motion.linearSpeed>.04||motion.angularSpeed>.12)return {truth:'false',reason:!contacts.length?'SUPPORT_CONTACT_MISSING':'SUPPORT_MOVING'};
  return {truth:'true',source:'physics-support',evidenceKind:'solver-contact+spatial-geometry',evidence:{geometry,contacts:contacts.slice(0,4),motion}};
}

export class SemanticWorldView {
  constructor(runtime) { this.runtime = runtime; }

  entity(id) {
    const runtime = this.runtime;
    const physical = recordFor(runtime, id);
    const project = Boolean(runtime?.projectCapabilities?.has?.(id));
    if (physical) { const providers=['runtime',...(project?['project']:[]),...(runtime?.thermal?.has?.(id)?['simulation']:[])];
      return { exists:true,source:'runtime',...(providers.length>1?{providers}:{}) }; }
    if (runtime?.affordances?.get?.(id)) return { exists:true, source:'environment' };
    if (project && runtime.projectCapabilities.attachmentOf?.(id) === 'runtime') {
      return { exists:false, source:'none', reason:'PROJECT_ATTACHMENT_TARGET_MISSING' };
    }
    if (project) return { exists:true, source:'project',...(inspectNativePhysics(runtime,id)?{providers:['project','native-physics']}:{}) };
    return { exists:false, source:'none', reason:'OBJECT_NOT_FOUND' };
  }

  state(targetId, stateKey, {source = null} = {}) {
    const owner = this.entity(targetId);
    const base = { kind:'state', targetId, stateKey, source:source || owner.source };
    if (!owner.exists) return unknown(base, owner.reason || 'OBJECT_NOT_FOUND');

    const runtime = this.runtime;
    const readers = [];
    const record = recordFor(runtime, targetId);
    if (record) readers.push(['runtime', () => record.state]);
    const environment = runtime?.affordances?.get?.(targetId);
    if (environment) readers.push(['environment', () => {
      if (environment.kind === 'text') {
        const error = new Error('ENVIRONMENT_TEXT_REQUIRES_ACTOR_READ');
        error.code = 'ENVIRONMENT_TEXT_REQUIRES_ACTOR_READ'; throw error;
      }
      return environment.read?.();
    }]);
    if (runtime?.projectCapabilities?.has?.(targetId)) {
      readers.push(['project', () => runtime.projectCapabilities.readState(targetId)]);
    }
    if (inspectNativePhysics(runtime,targetId)) readers.push(['native-physics',()=>inspectNativePhysics(runtime,targetId)?.state]);
    if (runtime?.thermal?.has?.(targetId)) readers.push(['simulation',()=>runtime.thermal.readState(targetId)]);
    const selected = readers.filter(([provider]) => source == null || provider === source);
    if (!selected.length) return unknown(base, 'STATE_PROVIDER_UNAVAILABLE');

    const found = [];
    for (const [provider, read] of selected) {
      let state;
      try { state = read(); }
      catch (error) { return unknown({ ...base, source:provider }, error?.code === 'ENVIRONMENT_TEXT_REQUIRES_ACTOR_READ'
        ? error.code : 'STATE_READ_FAILED'); }
      if (state && typeof state === 'object' && Object.hasOwn(state, stateKey) && state[stateKey] !== undefined) {
        found.push({ provider, value:state[stateKey] });
      }
    }
    if (!found.length) return unknown(base, 'STATE_NOT_OBSERVED');
    if (found.length > 1) return unknown({ ...base, source:'multiple',
      providers:found.map(item => item.provider) }, 'STATE_PROVIDER_CONFLICT');
    return { ...base, source:found[0].provider, status:'known',
      value:structuredClone(found[0].value), evidenceKind:'owner-state' };
  }

  relation({ subject, predicate, object, objectAnyOf, surfaceId } = {}) {
    const targets = objectAnyOf || [object];
    const base = { kind:'relation', subject, predicate, ...(objectAnyOf ? { objectAnyOf:[...objectAnyOf] } : { object }),
      ...(surfaceId ? { surfaceId } : {}) };
    const graph = this.runtime?.sceneGraph;
    if (!graph?.list) return { ...base, truth:'unknown', source:'none', reason:'RELATION_GRAPH_UNAVAILABLE' };

    let unobservable = false;
    try {
      graph.update?.();
      for (const target of targets) {
        if(['ON','SUPPORTS'].includes(predicate)&&[subject,target].some(id=>this.runtime?.entities?.get?.(id)?.source==='native')){
          const fact=physicalSupportFact(this.runtime,predicate==='ON'?subject:target,predicate==='ON'?target:subject,surfaceId);
          if(fact.truth==='true'||!objectAnyOf)return {...base,source:'physics-support',...fact};
          if(fact.truth==='unknown')unobservable=true;
          continue;
        }
        const edges = graph.list({ subject, predicate, object:target });
        const matching = edges.find(edge => !surfaceId || edge.meta?.surfaceId === surfaceId);
        if (matching) {
          return { ...base, truth:'true', source:'scene-graph',
            evidenceKind:matching.meta?.evidence || (spatialPredicates.has(predicate) ? 'spatial-relation' : 'declared-relation'),
            evidence:structuredClone(matching) };
        }
        // Absence is a reliable negative only when both objects participate in
        // the active spatial snapshot, or when a known edge has the wrong surface.
        const source = recordFor(this.runtime, subject), destination = recordFor(this.runtime, target);
        const measured = spatialPredicates.has(predicate) && typeof this.runtime?.spatial?.snapshot === 'function'
          && source?.active !== false && destination?.active !== false && Boolean(source && destination);
        if (!measured && !(surfaceId && edges.length)) unobservable = true;
      }
    } catch {
      return { ...base, truth:'unknown', source:'scene-graph', reason:'RELATION_READ_FAILED' };
    }
    return unobservable
      ? { ...base, truth:'unknown', source:'scene-graph', reason:'RELATION_NOT_OBSERVED' }
      : { ...base, truth:'false', source:'scene-graph', reason:'RELATION_NOT_FOUND' };
  }
}
