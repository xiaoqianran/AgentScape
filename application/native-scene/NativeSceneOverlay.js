import * as THREE from 'three';
import { EnvironmentPlugins, writeWorldDocument } from '../scene/WorldDocument.js';
import { exportWorldArchive, importWorldArchive } from '../scene/WorldArchive.js';
import { checkCancelled, worldStorageError } from '../scene/WorldStorage.js';

export const NATIVE_OVERLAY_SCHEMA = 'agentscape.native-overlay';
export const NATIVE_OVERLAY_VERSION = 1;

const fail = code => worldStorageError(code);
const validIdentity = value => typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/.test(value);

function checkHost(host, identity) {
  if (!host || !validIdentity(host.projectId) || (host.revision != null && !validIdentity(host.revision)))
    throw fail('NATIVE_HOST_IDENTITY_INVALID');
  if (host.projectId !== identity.projectId) throw fail('NATIVE_HOST_PROJECT_MISMATCH');
  if ((host.revision ?? null) !== (identity.revision ?? null)) throw fail('NATIVE_HOST_REVISION_MISMATCH');
}

export async function writeNativeSceneOverlay(world, storage, identity, { name = 'Native Scene Overlay', signal } = {}) {
  if (!validIdentity(identity?.projectId) || (identity.revision != null && !validIdentity(identity.revision)))
    throw fail('NATIVE_HOST_IDENTITY_INVALID');
  if (world.environment?.id !== 'native-scene') throw fail('NATIVE_ENVIRONMENT_REQUIRED');
  checkCancelled(signal);
  const worldRoot = await writeWorldDocument(world, storage, {
    name, signal, includeCamera: false, includeStyle: false, includeEnvironmentState: false
  });
  checkCancelled(signal);
  return storage.putNode('native-overlay', {
    schema: NATIVE_OVERLAY_SCHEMA,
    version: NATIVE_OVERLAY_VERSION,
    host: { projectId: identity.projectId, revision: identity.revision ?? null },
    world: worldRoot
  }, [worldRoot], { signal });
}

export async function inspectNativeSceneOverlay(storage, root, identity, { signal } = {}) {
  if (root?.kind !== 'native-overlay') throw fail('NATIVE_OVERLAY_FORMAT_UNSUPPORTED');
  const { data, refs } = await storage.node(root, { signal });
  if (data.schema !== NATIVE_OVERLAY_SCHEMA || data.version !== NATIVE_OVERLAY_VERSION)
    throw fail('NATIVE_OVERLAY_VERSION_UNSUPPORTED');
  checkHost(data.host, identity);
  if (data.world?.kind !== 'world' || JSON.stringify(refs) !== JSON.stringify([data.world]))
    throw fail('NATIVE_OVERLAY_DEPENDENCY_INVALID');
  const { data: worldData } = await storage.node(data.world, { signal });
  if (worldData.schema !== 'agentscape.world' || worldData.version !== 1 ||
      worldData.environment?.plugin !== 'native-scene' || worldData.header?.metadata?.environment !== 'native-scene')
    throw fail('NATIVE_OVERLAY_ENVIRONMENT_INVALID');
  return { host: structuredClone(data.host), world: data.world };
}

function nativePlugins(environment) {
  const plugins = new EnvironmentPlugins();
  plugins.register('native-scene', {
    create: async () => ({
      id: 'native-scene',
      root: new THREE.Group(),
      colliders: structuredClone(environment.colliders),
      ...(environment.navigationRoot ? { navigationRoot: environment.navigationRoot } : {}),
      dispose() {}
    })
  });
  return plugins;
}

export async function prepareNativeSceneOverlay(world, storage, root, identity, {
  signal, active = 'bounded', maxActiveEntities = 256, onStage
} = {}) {
  if (world.environment?.id !== 'native-scene') throw fail('NATIVE_ENVIRONMENT_REQUIRED');
  const inspected = await inspectNativeSceneOverlay(storage, root, identity, { signal });
  checkCancelled(signal);
  const { prepareWorld } = await import('../scene/WorldIO.js');
  const prepared = await prepareWorld(storage, inspected.world, {
    plugins: nativePlugins(world.environment), signal, active, maxActiveEntities, onStage
  });
  let state = 'prepared';
  return {
    summary: { ...prepared.summary, host: inspected.host, overlay: root },
    async commit() {
      if (state !== 'prepared') throw fail('NATIVE_OVERLAY_PREPARED_STATE');
      if (world.environment?.id !== 'native-scene') throw fail('NATIVE_ENVIRONMENT_CHANGED');
      checkCancelled(signal);
      state = 'committing';
      try {
        const result = await prepared.commit(world);
        state = 'committed';
        return result;
      } catch (error) {
        state = 'failed';
        throw error;
      }
    },
    dispose() {
      if (state === 'prepared') {
        state = 'disposed';
        prepared.dispose();
      }
    }
  };
}

export async function restoreNativeSceneOverlay(world, storage, root, identity, options = {}) {
  const prepared = await prepareNativeSceneOverlay(world, storage, root, identity, options);
  try { return await prepared.commit(); }
  finally { prepared.dispose(); }
}

export async function exportNativeSceneOverlay(storage, root, identity, writer, options = {}) {
  await inspectNativeSceneOverlay(storage, root, identity, options);
  return exportWorldArchive(storage, root, writer, options);
}

export async function importNativeSceneOverlay(storage, source, identity, options = {}) {
  const imported = await importWorldArchive(storage, source, options);
  await inspectNativeSceneOverlay(storage, imported.root, identity, options);
  return imported.root;
}
