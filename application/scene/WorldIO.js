import { createAssetModule } from '../../modules/asset/AssetModule.js';
import { assetManifests } from '../../modules/asset/registry/manifests/index.js';
import { SceneSerializer } from '../../modules/world/runtime/SceneSerializer.js';
import { inspectWorldDocument, writeWorldDocument, EnvironmentPlugins } from './WorldDocument.js';
import { importWorldArchive, exportWorldArchive } from './WorldArchive.js';
import { checkCancelled, worldStorageError } from './WorldStorage.js';
import { ENVIRONMENTS } from '../../modules/world/content/environments.js';

export function builtinEnvironmentPlugins() {
  const plugins = new EnvironmentPlugins();
  for (const environment of ENVIRONMENTS) plugins.register(environment.id, {
    create: async options => (await environment.load())({ loadAssets: typeof document !== 'undefined', ...options })
  });
  return plugins;
}

/** Single data import lifecycle: inspect, prepare isolated resources/state, validate, commit. */
export async function prepareWorld(storage, root, {
  plugins = builtinEnvironmentPlugins(), signal, active = 'saved', maxActiveEntities = 256, gltfLoader,
  onStage = () => {}
} = {}) {
  onStage('inspect');
  const document = await inspectWorldDocument(storage, root, { plugins, signal });
  if (!['saved', 'none', 'bounded'].includes(active) || !Number.isSafeInteger(maxActiveEntities) || maxActiveEntities < 0) throw worldStorageError('WORLD_ACTIVATION_BUDGET');
  onStage('prepare');
  const builtinManifests = Object.fromEntries(Object.entries(assetManifests).filter(([, manifest]) => manifest.source?.kind === 'builtin'));
  const assets = createAssetModule({ volatile: true, manifests: builtinManifests, manifestStore: null, libraryStore: null, gltfLoader });
  const ids = new Set(), manifests = [];
  for await (const page of storage.pages(document.assets, 'assets', { signal })) {
    for (const item of page) {
      if (typeof item.id !== 'string' || ids.has(item.id)) throw worldStorageError('WORLD_ASSET_ID_CONFLICT');
      ids.add(item.id);
      if (item.builtin === true) {
        if (!assets.hasAsset(item.id) || assets.getManifest(item.id).source.kind !== 'builtin') throw worldStorageError('WORLD_ASSET_UNAVAILABLE');
        continue;
      }
      if (assets.hasAsset(item.id) || item.definition?.id !== item.id || item.definition?.source) throw worldStorageError('WORLD_ASSET_ID_CONFLICT');
      const resource = await storage.node(item.resource, { signal });
      if (resource.data.format !== 'model/gltf-binary') throw worldStorageError('WORLD_RESOURCE_FORMAT');
      // Fully validate stream before any Runtime mutation, but retain no resource bytes.
      for await (const _chunk of storage.resource(item.resource, { signal })) checkCancelled(signal);
      const key = resource.data.sha256;
      if (!assets.compiledStore.sources.has(key)) assets.compiledStore.registerSource(key, {
        bytes: resource.data.size, read: () => storage.resource(item.resource)
      });
      const manifest = { ...item.definition, source: { kind: 'compiled', key } };
      assets.registry.registerManifest(manifest); manifests.push(manifest);
    }
  }
  const objects = []; let activeCount = 0;
  for await (const page of storage.pages(document.entities, 'entities', { signal })) {
    for (const object of page) {
      if (!ids.has(object.assetId)) throw worldStorageError('WORLD_DEPENDENCY_MISSING');
      if (!Number.isSafeInteger(object.ordinal) || object.ordinal < 0) throw worldStorageError('WORLD_ENTITY_ORDINAL');
      if (active === 'none' || (active === 'bounded' && activeCount >= maxActiveEntities)) object.active = false;
      if (object.active !== false && ++activeCount > maxActiveEntities) throw worldStorageError('WORLD_ACTIVATION_BUDGET');
      objects.push(object);
    }
  }
  objects.sort((a, b) => a.ordinal - b.ordinal);
  const ordered = objects.map(({ ordinal, ...object }, index) => {
    if (ordinal !== index) throw worldStorageError('WORLD_ENTITY_ORDINAL');
    return object;
  });
  onStage('validate');
  const snapshot = new SceneSerializer().validate({ ...document.header, objects: ordered, assets: manifests });
  checkCancelled(signal);
  const environment = await plugins.create(document.environment, {});
  if (signal?.aborted) { environment?.dispose?.(); checkCancelled(signal); }
  if (environment?.id !== document.environment.plugin) { environment?.dispose?.(); throw worldStorageError('WORLD_PLUGIN_ID_MISMATCH'); }
  let state = 'prepared';
  return {
    summary: { entities: objects.length, assets: ids.size, activeEntities: activeCount, dormantEntities: objects.length - activeCount, environment: environment.id },
    async commit(runtime) {
      if (state !== 'prepared') throw worldStorageError('WORLD_PREPARED_STATE');
      checkCancelled(signal); state = 'committing'; onStage('commit');
      try { await runtime.installWorld({ snapshot, assetModule: assets, environment }); state = 'committed'; }
      catch (error) { state = 'failed'; environment.dispose?.(); assets.loader.gltfLoader.dispose?.(); throw error; }
      return { root, entities: objects.length };
    },
    dispose() { if (state === 'prepared') { state = 'disposed'; environment.dispose?.(); assets.loader.gltfLoader.dispose?.(); } }
  };
}

export async function importWorld(runtime, storage, source, options = {}) {
  const { root } = await importWorldArchive(storage, source, options);
  const prepared = await prepareWorld(storage, root, options);
  try { return await prepared.commit(runtime); } finally { prepared.dispose(); }
}

export async function exportWorld(runtime, storage, writer, options = {}) {
  const root = await writeWorldDocument(runtime, storage, options);
  if (writer) await exportWorldArchive(storage, root, writer, options);
  return root;
}
