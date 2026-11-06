import { WorldStorage, blobChunks } from '../../../application/scene/WorldStorage.js';
import { WorldDirectory } from '../../../application/scene/WorldDirectory.js';
import { exportWorld, prepareWorld } from '../../../application/scene/WorldIO.js';
import { importWorldArchive } from '../../../application/scene/WorldArchive.js';

/** Browser adapter: persistent hash blocks plus a streaming user-selected file. */
async function browserStorage() {
  if (!globalThis.navigator?.storage?.getDirectory) throw new Error('WORLD_STORAGE_UNAVAILABLE');
  const origin = await navigator.storage.getDirectory();
  const blocks = await origin.getDirectoryHandle('agentscape-world-blocks', { create:true });
  return new WorldStorage(new WorldDirectory(blocks));
}

export async function exportWorldFile(world, environmentId) {
  const filename = `agentscape-${environmentId}.asworld`;
  let writer;
  let cleanup = null;
  if (typeof globalThis.showSaveFilePicker === 'function') {
    // Request user permission before any await other than the picker itself.
    const handle = await globalThis.showSaveFilePicker({
      suggestedName:filename,
      types:[{ description:'AgentScape World', accept:{'application/octet-stream':['.asworld']} }]
    });
    writer = await handle.createWritable();
  } else {
    // OPFS-backed downloadable File avoids building an entire archive as a JS Uint8Array.
    if (!globalThis.document) throw new Error('WORLD_STREAM_SAVE_UNAVAILABLE');
    const root = await navigator.storage?.getDirectory?.();
    if (!root) throw new Error('WORLD_STREAM_SAVE_UNAVAILABLE');
    const temporaryName = `agentscape-export-${crypto.randomUUID()}.asworld`;
    const handle = await root.getFileHandle(temporaryName,{create:true});
    writer = await handle.createWritable();
    cleanup = async () => {
      const file = await handle.getFile();
      const url = URL.createObjectURL(file);
      const anchor = document.createElement('a');
      anchor.href = url; anchor.download = filename; anchor.click();
      setTimeout(() => {
        URL.revokeObjectURL(url);
        root.removeEntry(temporaryName).catch(() => {});
      },30000);
    };
  }
  try {
    const storage = await browserStorage();
    const root = await exportWorld(world, storage, writer);
    await writer.close();
    await cleanup?.();
    return root;
  } catch (error) {
    await writer.abort?.().catch(() => {});
    throw error;
  }
}

export async function importWorldFile(world, file, { maxActiveEntities = 256 } = {}) {
  const storage = await browserStorage();
  // Immutable blocks may be staged before validation, but the current Runtime
  // must remain unchanged until all dependencies and entities pass inspection.
  const { root } = await importWorldArchive(storage, blobChunks(file));
  const prepared = await prepareWorld(storage, root, { maxActiveEntities, active:'bounded' });
  try {
    if (prepared.summary.environment !== world.environment?.id) throw new Error('WORLD_ENVIRONMENT_MISMATCH');
    await prepared.commit(world);
    return prepared.summary;
  } finally { prepared.dispose(); }
}
