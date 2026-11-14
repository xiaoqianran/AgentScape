// A read-only semantic projection. State and geometry remain owned by their providers.
const spatialPredicates = new Set(['ON', 'NEAR', 'INSIDE', 'CONTAINS', 'SUPPORTS']);

function recordFor(runtime, id) {
  if (!runtime?.store?.get || runtime.store.has?.(id) === false) return null;
  try { return runtime.store.get(id) || null; }
  catch { return null; }
}

function unknown(base, reason) { return { ...base, status:'unknown', reason }; }

export class SemanticWorldView {
  constructor(runtime) { this.runtime = runtime; }

  entity(id) {
    const runtime = this.runtime;
    if (recordFor(runtime, id)) return { exists:true, source:'runtime' };
    if (runtime?.affordances?.get?.(id)) return { exists:true, source:'environment' };
    if (runtime?.projectCapabilities?.has?.(id)) return { exists:true, source:'project' };
    return { exists:false, source:'none', reason:'OBJECT_NOT_FOUND' };
  }

  state(targetId, stateKey) {
    const owner = this.entity(targetId);
    const base = { kind:'state', targetId, stateKey, source:owner.source };
    if (!owner.exists) return unknown(base, 'OBJECT_NOT_FOUND');

    const runtime = this.runtime;
    try {
      let state;
      if (owner.source === 'runtime') state = recordFor(runtime, targetId)?.state;
      else if (owner.source === 'environment') {
        const entry = runtime.affordances.get(targetId);
        if (entry.kind === 'text') return unknown(base, 'ENVIRONMENT_TEXT_REQUIRES_ACTOR_READ');
        state = entry.read?.();
      } else state = runtime.projectCapabilities.readState(targetId);

      if (!state || typeof state !== 'object' || !Object.hasOwn(state, stateKey) || state[stateKey] === undefined) {
        return unknown(base, 'STATE_NOT_OBSERVED');
      }
      return { ...base, status:'known', value:structuredClone(state[stateKey]), evidenceKind:'owner-state' };
    } catch {
      return unknown(base, 'STATE_READ_FAILED');
    }
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
