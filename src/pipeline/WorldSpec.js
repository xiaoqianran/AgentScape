const finiteVec3 = (value, fallback = null) => {
  if (value == null && fallback) return [...fallback];
  if (!Array.isArray(value) || value.length !== 3 || !value.every(Number.isFinite)) return null;
  return value.map(Number);
};

const clean = (value) => typeof value === 'string' ? value.trim() : '';

export function normalizeWorldSpec(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new TypeError('WorldSpec must be an object');
  const generation = input.generation && typeof input.generation === 'object' ? input.generation : {};
  const defaultProvider = clean(generation.provider) || null;
  const defaultGenerate = generation.generate === true;
  const ids = new Set();
  const assets = (input.assets || []).map((request, index) => {
    if (!request || typeof request !== 'object' || Array.isArray(request)) throw new TypeError(`WorldSpec asset[${index}] must be an object`);
    const assetId = clean(request.assetId) || null;
    const type = clean(request.type) || null;
    const prompt = clean(request.prompt) || null;
    const query = clean(request.query) || prompt || type || assetId;
    if (!query) throw new TypeError(`WorldSpec asset[${index}] requires assetId, query, prompt, or type`);
    const id = clean(request.id) || null;
    if (id && ids.has(id)) throw new TypeError(`WorldSpec duplicate instance id: ${id}`);
    if (id) ids.add(id);
    const position = finiteVec3(request.position, [0,0,0]);
    if (!position) throw new TypeError(`WorldSpec asset[${index}] position requires finite [3]`);
    const provider = clean(request.provider) || defaultProvider;
    return {
      ...(id ? { id } : {}),
      ...(assetId ? { assetId } : {}),
      query,
      ...(type ? { type } : {}),
      ...(prompt ? { prompt } : {}),
      position,
      generate: request.generate == null ? defaultGenerate : request.generate === true,
      ...(provider ? { provider } : {})
    };
  });
  const relations = (input.relations || []).map((relation, index) => {
    if (!relation || typeof relation !== 'object' || Array.isArray(relation)) throw new TypeError(`WorldSpec relation[${index}] must be an object`);
    const subject = clean(relation.subject), predicate = clean(relation.predicate).toUpperCase(), object = clean(relation.object);
    if (!subject || !predicate || !object) throw new TypeError(`WorldSpec relation[${index}] requires subject, predicate, object`);
    if (!['ON','NEAR'].includes(predicate)) throw new TypeError(`WorldSpec relation[${index}] unsupported predicate: ${predicate}`);
    const distance = relation.distance == null ? null : Number(relation.distance);
    if (distance != null && (!Number.isFinite(distance) || distance <= 0)) throw new TypeError(`WorldSpec relation[${index}] distance must be positive finite`);
    return { subject, predicate, object, ...(clean(relation.surfaceId) ? { surfaceId:clean(relation.surfaceId) } : {}), ...(distance != null ? { distance } : {}) };
  });
  return {
    schema: 1,
    name: clean(input.name) || 'Generated World',
    description: clean(input.description),
    generation: { ...(defaultProvider ? { provider:defaultProvider } : {}), generate:defaultGenerate },
    assets,
    relations
  };
}
