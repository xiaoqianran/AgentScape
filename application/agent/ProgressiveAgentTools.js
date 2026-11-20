/**
 * Studio-only progressive disclosure for the large runtime tool catalog.
 * Discovery changes LLM visibility, not Runtime permissions or capabilities.
 */
const INITIAL_TOOLS = Object.freeze([
  'listObjects', 'observeScene', 'verifyScene', 'planSceneTask', 'interactScene',
  'searchAssets', 'generateAsset', 'addSceneModel',
  'approachAndInteract', 'approachAndPickup', 'approachAndPlace',
  'navigateTo', 'listInteractablesNearMe',
  'readStudioProject', 'writeStudioProject', 'readStudioFile', 'editStudioFile',
  'previewStudioProjectBatch', 'applyStudioProjectBatch', 'runStudioProject', 'saveStudioProject'
]);

const DISCOVER = Object.freeze({
  name:'discoverAgentTools',
  description:'List additional available tool names and short descriptions, or activate up to 20 named tools for the next planning round. Call with {} to inspect the catalog; then call with names:[...] to expose full JSON schemas. This changes only tool visibility, never world state.',
  parameters:{
    type:'object',
    properties:{
      query:{type:'string',description:'Optional name/description search; omit to list every available tool.'},
      names:{type:'array',items:{type:'string'},minItems:1,maxItems:20,description:'Existing tool names to expose in subsequent planning rounds.'}
    },
    additionalProperties:false
  }
});

function invalidCatalogRequest(message) {
  const error = new Error(message);
  error.code = 'TOOL_DISCOVERY_INVALID';
  return error;
}

/** Wrap only the LLM-facing Studio tools. Direct Studio/MCP invocations remain unchanged. */
export function createProgressiveAgentTools(base, { initialNames = INITIAL_TOOLS } = {}) {
  if (!base || typeof base.definitions !== 'function' || typeof base.call !== 'function')
    throw new TypeError('Progressive tools require AgentTools');
  let exposed = new Set(initialNames);
  const fullDefinitions = () => base.definitions();

  return {
    get runtime() { return base.runtime; },
    get actor() { return base.actor; },
    beginTask(text) {
      exposed = new Set(initialNames);
      base.beginTask?.(text);
    },
    fullDefinitions,
    definitions() {
      return [...fullDefinitions().filter(tool => exposed.has(tool.name)), DISCOVER];
    },
    executionPolicy(name, result) {
      if (name === DISCOVER.name) return {
        mutates:false, history:false, barrier:false, auxiliary:true,
        tracksUnresolved:false, batchable:false, batchAcceptable:true,
        outcome:{state:'accepted',verified:null}
      };
      return base.executionPolicy(name,result);
    },
    taskObservation(state) { return base.taskObservation?.(state) || null; },
    recordSequence(payload) { return base.recordSequence?.(payload); },
    async call(name, args = {}, context = {}) {
      if (name !== DISCOVER.name) return base.call(name,args,context);
      const catalog = fullDefinitions();
      const byName = new Map(catalog.map(tool => [tool.name,tool]));
      base.runtime?.events?.emit?.('tool.called',{name,args,source:'studio-agent-discovery'});
      if (args.names !== undefined) {
        if (!Array.isArray(args.names) || args.names.length < 1 || args.names.length > 20)
          throw invalidCatalogRequest('names must contain 1-20 available tool names');
        const names = [...new Set(args.names)];
        const unknown = names.filter(value => typeof value !== 'string' || !byName.has(value));
        if (unknown.length) throw invalidCatalogRequest('Unknown tool names: ' + unknown.map(String).join(', '));
        for (const value of names) exposed.add(value);
        return {status:'tool-catalog-updated',exposed:names,
          totalExposed:catalog.filter(tool=>exposed.has(tool.name)).length,
          instruction:'The named tool schemas will appear in the next planning round.'};
      }
      if (args.query !== undefined && typeof args.query !== 'string')
        throw invalidCatalogRequest('query must be a string');
      const query=(args.query || '').trim().toLowerCase();
      const remaining=catalog.filter(tool=>!exposed.has(tool.name));
      const matched=query
        ? remaining.filter(tool=>(tool.name+' '+(tool.description||'')).toLowerCase().includes(query))
        : remaining;
      return {
        status:'tool-catalog',totalAvailable:catalog.length,totalHidden:remaining.length,
        query:query || null,
        tools:matched.map(tool=>({name:tool.name,description:String(tool.description || '').slice(0,125)})),
        instruction:'Call discoverAgentTools with names:[...] to expose selected tool schemas.'
      };
    }
  };
}
