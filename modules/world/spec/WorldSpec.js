export const WORLD_SPEC_SCHEMA = {
  type:'object',additionalProperties:false,
  properties:{
    name:{type:'string',description:'Human-readable world name.'},description:{type:'string',description:'World intent and task context; not executable truth.'},
    generation:{type:'object',additionalProperties:false,properties:{provider:{type:'string',description:'Generator provider for missing assets.'},generate:{type:'boolean',description:'Allow generation only when reuse cannot resolve an asset.'}}},
    assets:{type:'array',items:{type:'object',additionalProperties:false,properties:{
      id:{type:'string',description:'Instance id inside the new world, e.g. table_01. This is not the asset catalog id.'},assetId:{type:'string',description:'Existing registered asset id, normally copied from searchAssets result.id when reusing an asset.'},query:{type:'string',description:'Asset-library lookup query when assetId is not known.'},prompt:{type:'string',description:'Generator prompt for a missing asset; does not imply verification.'},type:{type:'string',description:'Semantic asset type used for reuse lookup or generation intent.'},
      position:{type:'array',items:{type:'number'},minItems:3,maxItems:3,description:'Optional exact world position. Omit unless the user explicitly constrains coordinates; Runtime composes omitted positions.'},generate:{type:'boolean',description:'Whether this request may generate if reuse fails.'},provider:{type:'string',description:'Per-asset generator provider override.'}
    }}},
    relations:{type:'array',items:{type:'object',additionalProperties:false,required:['subject','predicate','object'],properties:{
      subject:{type:'string',description:'World instance id being placed/moved.'},predicate:{type:'string',enum:['ON','NEAR','INSIDE']},object:{type:'string',description:'World instance id used as support/near target.'},surfaceId:{type:'string'},receptacleId:{type:'string'},distance:{type:'number',exclusiveMinimum:0,description:'Optional center distance for NEAR. Omit to let Runtime derive safe spacing from collider footprints.'}
    }}}
  }
};

const finiteVec3 = (value, fallback = null) => {
  if (value == null && fallback) return [...fallback];
  if (!Array.isArray(value) || value.length !== 3 || !value.every(Number.isFinite)) return null;
  return value.map(Number);
};

const clean = (value) => typeof value === 'string' ? value.trim() : '';

const assertKnownKeys = (value, allowed, label) => {
  for (const key of Object.keys(value || {})) {
    if (!allowed.has(key)) throw new TypeError(`${label} unknown field: ${key}`);
  }
};

const TOP_LEVEL_KEYS=new Set(['name','description','generation','assets','relations']);
const GENERATION_KEYS=new Set(['provider','generate']);
const ASSET_KEYS=new Set(['id','assetId','query','prompt','type','position','generate','provider']);
const RELATION_KEYS=new Set(['subject','predicate','object','surfaceId','receptacleId','distance']);

export function normalizeWorldSpec(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new TypeError('WorldSpec must be an object');
  assertKnownKeys(input,TOP_LEVEL_KEYS,'WorldSpec');
  const generation = input.generation && typeof input.generation === 'object' ? input.generation : {};
  assertKnownKeys(generation,GENERATION_KEYS,'WorldSpec generation');
  const defaultProvider = clean(generation.provider) || null;
  const defaultGenerate = generation.generate === true;
  const ids = new Set();
  const assets = (input.assets || []).map((request, index) => {
    if (!request || typeof request !== 'object' || Array.isArray(request)) throw new TypeError(`WorldSpec asset[${index}] must be an object`);
    assertKnownKeys(request,ASSET_KEYS,`WorldSpec asset[${index}]`);
    const assetId = clean(request.assetId) || null;
    const type = clean(request.type) || null;
    const prompt = clean(request.prompt) || null;
    const query = clean(request.query) || prompt || type || assetId;
    if (!query) throw new TypeError(`WorldSpec asset[${index}] requires assetId, query, prompt, or type`);
    const id = clean(request.id) || null;
    if (id && ids.has(id)) throw new TypeError(`WorldSpec duplicate instance id: ${id}`);
    if (id) ids.add(id);
    const position = request.position == null ? null : finiteVec3(request.position);
    if (request.position != null && !position) throw new TypeError(`WorldSpec asset[${index}] position requires finite [3]`);
    const provider = clean(request.provider) || defaultProvider;
    return {
      ...(id ? { id } : {}),
      ...(assetId ? { assetId } : {}),
      query,
      ...(type ? { type } : {}),
      ...(prompt ? { prompt } : {}),
      ...(position ? { position } : {}),
      generate: request.generate == null ? defaultGenerate : request.generate === true,
      ...(provider ? { provider } : {})
    };
  });
  const relations = (input.relations || []).map((relation, index) => {
    if (!relation || typeof relation !== 'object' || Array.isArray(relation)) throw new TypeError(`WorldSpec relation[${index}] must be an object`);
    assertKnownKeys(relation,RELATION_KEYS,`WorldSpec relation[${index}]`);
    const subject = clean(relation.subject), predicate = clean(relation.predicate).toUpperCase(), object = clean(relation.object);
    if (!subject || !predicate || !object) throw new TypeError(`WorldSpec relation[${index}] requires subject, predicate, object`);
    if (!['ON','NEAR','INSIDE'].includes(predicate)) throw new TypeError(`WorldSpec relation[${index}] unsupported predicate: ${predicate}`);
    const distance = relation.distance == null ? null : Number(relation.distance);
    if (distance != null && (!Number.isFinite(distance) || distance <= 0)) throw new TypeError(`WorldSpec relation[${index}] distance must be positive finite`);
    return { subject, predicate, object, ...(clean(relation.surfaceId) ? { surfaceId:clean(relation.surfaceId) } : {}), ...(clean(relation.receptacleId) ? { receptacleId:clean(relation.receptacleId) } : {}), ...(distance != null ? { distance } : {}) };
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
