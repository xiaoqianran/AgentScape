import { AssetLibrary } from '../assets/library/AssetLibrary.js';
import { HttpAssetGenerator } from '../assets/gateway/HttpAssetGenerator.js';
import { HttpCompilerProvider } from '../compiler/providers/HttpCompilerProvider.js';
import { ConnectorClient } from '../connector/ConnectorClient.js';
import { GenerationOrchestrator } from '../generation/GenerationOrchestrator.js';

const readSetting = (storage, key) => {
  try { return storage?.getItem?.(key) || ''; }
  catch { return ''; }
};

export function attachLegacyAuthoring(runtime, {
  storage = globalThis.localStorage ?? null,
  compilerProvider = null,
  assetGenerator = null,
  connectorClient = undefined,
  generationOptions = {}
} = {}) {
  if (!runtime?.assets || !runtime?.assetCatalog || !runtime?.compiledAssetStore || !runtime?.events) {
    throw new TypeError('Legacy authoring requires an initialized WorldRuntime domain shell');
  }
  if (runtime.authoring) return runtime.authoring;

  const compiler = compilerProvider || new HttpCompilerProvider({
    endpoint: readSetting(storage, 'agentscape.compilerEndpoint')
  });
  const generator = assetGenerator || new HttpAssetGenerator({
    endpoint: readSetting(storage, 'agentscape.assetGeneratorEndpoint')
  });
  const library = new AssetLibrary({
    assetManager: runtime.assets,
    catalog: runtime.assetCatalog,
    generator,
    events: runtime.events
  });

  let connector = connectorClient;
  let connectorError = null;
  if (connector === undefined) {
    connector = null;
    const endpoint = readSetting(storage, 'agentscape.connectorEndpoint');
    if (endpoint) {
      try { connector = new ConnectorClient({ endpoint }); }
      catch (error) {
        connectorError = {
          code: error.code || 'CONNECTOR_ENDPOINT_INVALID',
          message: error.message
        };
      }
    }
  }

  let assetCompiler = null;
  const getAssetCompiler = async () => {
    if (!assetCompiler) {
      const { AssetCompiler } = await import('../compiler/AssetCompiler.js');
      assetCompiler = new AssetCompiler({
        store: runtime.compiledAssetStore,
        provider: compiler,
        events: runtime.events,
        version: runtime.version
      });
    }
    return assetCompiler;
  };

  const generation = new GenerationOrchestrator({
    providerRegistry: library.providerRegistry,
    connectorClient: connector,
    assetManager: runtime.assets,
    getAssetCompiler,
    events: runtime.events,
    ...generationOptions
  });
  library.attachGeneration(generation);

  const authoring = {
    compilerProvider: compiler,
    assetGenerator: generator,
    assetLibrary: library,
    generation,
    connectorError,
    getAssetCompiler,
    async initialize({ pair = true, pairingId = null } = {}) {
      let state = {
        status: 'connection-required',
        reason: connector ? 'PAIRING_REQUIRED' : 'CONNECTOR_NOT_CONFIGURED'
      };
      if (connector) {
        try { state = await generation.initialize({ pair, pairingId }); }
        catch (error) {
          state = {
            status: 'connection-required',
            reason: error.code || 'CONNECTOR_INITIALIZATION_FAILED'
          };
        }
      }
      runtime.generationState = state;
      runtime.events.emit('generation.state', structuredClone(state));
      return state;
    }
  };

  runtime.authoring = authoring;
  runtime.compilerProvider = compiler;
  runtime.assetGenerator = generator;
  runtime.assetLibrary = library;
  runtime.generation = generation;
  runtime.generationConnectorError = connectorError;
  runtime.generationState = {
    status: 'connection-required',
    reason: connector ? 'PAIRING_REQUIRED' : 'CONNECTOR_NOT_CONFIGURED'
  };
  runtime.getAssetCompiler = getAssetCompiler;
  return authoring;
}
