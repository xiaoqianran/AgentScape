const clean = (value) => typeof value === 'string' ? value.trim() : '';

const confidence = (value) => Number.isFinite(value?.confidence) ? value.confidence : -Infinity;

export function serializeObservedEntityEdge(edge) {
  if (!edge) return null;
  const meta = structuredClone(edge.meta || {});
  const observationId = clean(meta.id) || null;
  delete meta.id;
  return { id:edge.object, observationId, ...meta };
}

export function listObservedEntities(sceneGraph, { label = null } = {}) {
  sceneGraph?.update?.();
  const wanted = clean(label).toLocaleLowerCase();
  return (sceneGraph?.list?.({ predicate:'HAS_INSTANCE' }) || [])
    .map(serializeObservedEntityEdge)
    .filter(Boolean)
    .filter((entity) => !wanted || clean(entity.label).toLocaleLowerCase() === wanted)
    .sort((a, b) => confidence(b) - confidence(a) || String(a.id).localeCompare(String(b.id)));
}

export function resolveObservedEntity(sceneGraph, selector = {}) {
  const id = clean(selector.id);
  const label = clean(selector.label).toLocaleLowerCase();
  const candidates = listObservedEntities(sceneGraph)
    .filter((entity) => !id || entity.id === id || entity.observationId === id)
    .filter((entity) => !label || clean(entity.label).toLocaleLowerCase() === label);
  if (!candidates.length) return {
    status:'missing', selector:{ ...(id ? {id} : {}), ...(label ? {label} : {}) },
    candidateCount:0, selection:'highest-confidence-then-id', entity:null
  };
  return {
    status:'resolved', selector:{ ...(id ? {id} : {}), ...(label ? {label} : {}) },
    candidateCount:candidates.length, selection:'highest-confidence-then-id', entity:structuredClone(candidates[0])
  };
}
