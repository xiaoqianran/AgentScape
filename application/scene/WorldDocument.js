import { WORLD_BLOCK_BYTES, checkCancelled, worldStorageError } from './WorldStorage.js';

export const WORLD_SCHEMA = 'agentscape.world';
export const WORLD_VERSION = 1;

/** Only small metadata is in the root. Entity and asset pages are content-addressed chains. */
export async function writeWorldDocument(runtime, storage, { name = 'Untitled World', signal } = {}) {
  if (runtime.mutationOwner) throw worldStorageError('WORLD_BUSY');
  return runtime.exclusiveMutation('world:save', () => writeLocked(runtime, storage, { name, signal }));
}

async function writeLocked(runtime, storage, { name, signal }) {
  const header = runtime.serializer.serialize(runtime, { name, includeRelations: false, includeObjects: false });
  delete header.objects; delete header.assets;
  const assets = new Set();
  async function* entities() {
    let ordinal = 0;
    for (const entity of runtime.serializer.objects(runtime)) {
      assets.add(entity.assetId);
      yield { ...entity, ordinal: ordinal++ };
    }
  }
  const entitiesRef = await storage.writePages('entities', entities(), { signal });
  async function* assetEntries() {
    for (const id of assets) {
      checkCancelled(signal);
      const manifest = runtime.assetModule.getManifest(id);
      if (manifest.source.kind === 'builtin') {
        yield { id, builtin: true }; continue;
      }
      // This read is one decode unit, never all world resources. AssetModule must enforce its decode budget.
      const bytes = await runtime.assetModule.readAssetBytes(id);
      async function* chunks() {
        for (let offset = 0; offset < bytes.length; offset += WORLD_BLOCK_BYTES) yield bytes.subarray(offset, offset + WORLD_BLOCK_BYTES);
      }
      const resource = await storage.putResource(chunks(), { format: 'model/gltf-binary', signal });
      const definition = structuredClone(manifest);
      delete definition.source; delete definition.compiler; delete definition.verification;
      yield { id, resource, definition };
    }
  }
  const assetsRef = await storage.writePages('assets', assetEntries(), { signal });
  return storage.putNode('world', { schema: WORLD_SCHEMA, version: WORLD_VERSION, header,
    environment: { plugin: runtime.environment.id, version: 1 }, entities: entitiesRef, assets: assetsRef },
  [entitiesRef, assetsRef].filter(Boolean), { signal });
}

export async function inspectWorldDocument(storage, root, { plugins, signal } = {}) {
  if (root?.kind !== 'world') throw worldStorageError('WORLD_FORMAT_UNSUPPORTED');
  const { data, refs } = await storage.node(root, { signal });
  if (data.schema !== WORLD_SCHEMA || data.version !== WORLD_VERSION) throw worldStorageError('WORLD_VERSION_UNSUPPORTED');
  if (JSON.stringify(refs) !== JSON.stringify([data.entities, data.assets].filter(Boolean))) throw worldStorageError('WORLD_DEPENDENCY_INVALID');
  if (!data.environment || data.environment.version !== 1 || !plugins?.has(data.environment.plugin)) throw worldStorageError('WORLD_PLUGIN_UNAVAILABLE');
  if (data.header?.metadata?.environment !== data.environment.plugin) throw worldStorageError('WORLD_ENVIRONMENT_MISMATCH');
  return data;
}

/** Host explicitly registers trusted implementations. Package data never supplies executable source. */
export class EnvironmentPlugins {
  constructor() { this.entries = new Map(); }
  register(id, { version = 1, create }) {
    if (!id || version !== 1 || typeof create !== 'function' || this.entries.has(id)) throw worldStorageError('WORLD_PLUGIN_INVALID');
    this.entries.set(id, { version, create }); return this;
  }
  has(id) { return this.entries.has(id); }
  async create(descriptor, options) {
    const plugin = this.entries.get(descriptor.plugin);
    if (!plugin || plugin.version !== descriptor.version) throw worldStorageError('WORLD_PLUGIN_UNAVAILABLE');
    return plugin.create(options);
  }
}
