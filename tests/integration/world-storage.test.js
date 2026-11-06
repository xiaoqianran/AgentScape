import { it, expect } from 'vitest';
import { mkdtemp, rm, readdir, open, stat, writeFile } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { WorldStorage, WORLD_BLOCK_BYTES } from '../../application/scene/WorldStorage.js';
import { WorldDiskStorage } from '../../apps/server/WorldDiskStorage.js';
import { exportWorldArchive, importWorldArchive } from '../../application/scene/WorldArchive.js';

it('streams a >64 MiB resource through disk, deduplicates, closes and restores without whole-file reads', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'agentscape-world-blocks-'));
  try {
    const storage = new WorldStorage(await new WorldDiskStorage(path.join(directory, 'source')).initialize());
    async function* resource() {
      for (let i = 0; i < 70; i++) { const bytes = new Uint8Array(WORLD_BLOCK_BYTES); bytes.fill(i); yield bytes; }
    }
    const ref = await storage.putResource(resource(), { format: 'test/binary' });
    const count = (await readdir(path.join(directory, 'source'))).length;
    expect(await storage.putResource(resource(), { format: 'test/binary' })).toEqual(ref);
    expect((await readdir(path.join(directory, 'source'))).length).toBe(count);
    const root = await storage.putNode('world', { schema: 'agentscape.world', version: 1 }, [ref]);
    const archivePath = path.join(directory, 'world.asworld');
    const writer = await open(archivePath, 'wx');
    try { await exportWorldArchive(storage, root, { write: bytes => writer.writeFile(bytes) }); }
    finally { await writer.close(); }
    expect((await stat(archivePath)).size).toBeGreaterThan(64 * 1024 * 1024);
    const reopened = new WorldStorage(await new WorldDiskStorage(path.join(directory, 'restored')).initialize());
    const imported = await importWorldArchive(reopened, createReadStream(archivePath, { highWaterMark: 65536 }));
    expect(imported.root).toEqual(root);
    let size = 0, index = 0;
    for await (const bytes of reopened.resource(ref)) {
      expect(bytes.length).toBeLessThanOrEqual(WORLD_BLOCK_BYTES);
      expect(bytes[0]).toBe(index++); size += bytes.length;
    }
    expect(size).toBe(70 * WORLD_BLOCK_BYTES);
    await writeFile(path.join(directory, 'restored', ref.hash), 'corrupt');
    await expect(reopened.node(ref)).rejects.toThrow('WORLD_SIZE_MISMATCH');
    expect((await storage.node(ref)).data.size).toBe(size);
  } finally { await rm(directory, { recursive: true, force: true }); }
}, 120000);

it('rejects unsafe paths, oversized chunks, invalid archives and cancellation', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'agentscape-world-invalid-'));
  try {
    const storage = new WorldStorage(await new WorldDiskStorage(directory).initialize());
    await expect(storage.read({ hash: '../escape', bytes: 1 })).rejects.toThrow('WORLD_HASH_INVALID');
    await expect(storage.put(new Uint8Array(WORLD_BLOCK_BYTES + 1))).rejects.toThrow('WORLD_BLOCK_BUDGET');
    const controller = new AbortController(); controller.abort();
    await expect(storage.put(new Uint8Array(), { signal: controller.signal })).rejects.toThrow('WORLD_CANCELLED');
    async function* bad() { yield new TextEncoder().encode('PKZIPxxx'); }
    await expect(importWorldArchive(storage, bad())).rejects.toThrow('WORLD_FORMAT_UNSUPPORTED');
    expect(await readdir(directory)).toEqual([]);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
