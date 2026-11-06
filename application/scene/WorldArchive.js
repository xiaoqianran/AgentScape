import { WORLD_BLOCK_BYTES, checkHash, hashBytes, checkCancelled, worldStorageError } from './WorldStorage.js';

const encoder = new TextEncoder(), decoder = new TextDecoder('utf-8', { fatal: true });
const MAGIC = encoder.encode('ASWORLD1');
const u32 = value => { const bytes = new Uint8Array(4); new DataView(bytes.buffer).setUint32(0, value); return bytes; };

/** Uncompressed framed content blocks. No filenames, links, executable code or decompression. */
export async function exportWorldArchive(storage, root, writer, { linked = false, signal } = {}) {
  if (!writer?.write) throw new TypeError('A backpressured binary writer is required');
  const header = encoder.encode(JSON.stringify({ schema: 'agentscape.world-package', version: 1, root, linked }));
  if (header.length > 4096) throw worldStorageError('WORLD_HEADER_BUDGET');
  const write = async bytes => { checkCancelled(signal); await writer.write(bytes); };
  await write(MAGIC); await write(u32(header.length)); await write(header);
  const pending = [root], visited = new Set();
  while (!linked && pending.length) {
    const ref = pending.pop();
    if (visited.has(ref.hash)) continue;
    visited.add(ref.hash);
    const bytes = await storage.read(ref, { signal });
    const descriptor = encoder.encode(JSON.stringify(ref));
    if (descriptor.length > 4096) throw worldStorageError('WORLD_HEADER_BUDGET');
    await write(u32(descriptor.length)); await write(descriptor); await write(bytes);
    if (ref.kind) pending.push(...(await storage.node(ref, { signal })).refs);
  }
  await write(u32(0));
  return { root, blocks: visited.size, linked };
}

class Reader {
  constructor(source, signal) { this.source = source[Symbol.asyncIterator](); this.signal = signal; this.chunk = new Uint8Array(); this.offset = 0; }
  async take(length) {
    if (length > WORLD_BLOCK_BYTES) throw worldStorageError('WORLD_BLOCK_BUDGET');
    const result = new Uint8Array(length); let written = 0;
    while (written < length) {
      checkCancelled(this.signal);
      if (this.offset === this.chunk.length) {
        const item = await this.source.next();
        if (item.done) throw worldStorageError('WORLD_TRUNCATED');
        if (!(item.value instanceof Uint8Array) || item.value.length > WORLD_BLOCK_BYTES || !item.value.length) throw worldStorageError('WORLD_SOURCE_CHUNK_BUDGET');
        this.chunk = item.value; this.offset = 0;
      }
      const take = Math.min(length - written, this.chunk.length - this.offset);
      result.set(this.chunk.subarray(this.offset, this.offset + take), written); written += take; this.offset += take;
    }
    return result;
  }
  async number() { return new DataView((await this.take(4)).buffer).getUint32(0); }
  async json(length) {
    if (!length || length > 4096) throw worldStorageError('WORLD_HEADER_BUDGET');
    try { return JSON.parse(decoder.decode(await this.take(length))); }
    catch (error) { if (error.code) throw error; throw worldStorageError('WORLD_HEADER_INVALID'); }
  }
  async end() { if (this.offset !== this.chunk.length || !(await this.source.next()).done) throw worldStorageError('WORLD_TRAILING_BYTES'); }
}

/** Writes immutable blocks only. Caller publishes the returned root after semantic validation/commit. */
export async function importWorldArchive(storage, source, { signal } = {}) {
  const reader = new Reader(source, signal);
  try {
    if (decoder.decode(await reader.take(8)) !== 'ASWORLD1') throw worldStorageError('WORLD_FORMAT_UNSUPPORTED');
    const header = await reader.json(await reader.number());
    if (header.schema !== 'agentscape.world-package' || header.version !== 1 || typeof header.linked !== 'boolean') throw worldStorageError('WORLD_VERSION_UNSUPPORTED');
    checkHash(header.root?.hash);
    const visited = new Set();
    while (true) {
      const length = await reader.number(); if (!length) break;
      if (header.linked) throw worldStorageError('WORLD_LINKED_PAYLOAD');
      const ref = await reader.json(length); checkHash(ref?.hash);
      if (visited.has(ref.hash)) throw worldStorageError('WORLD_DUPLICATE_BLOCK');
      if (!Number.isSafeInteger(ref.bytes) || ref.bytes < 0 || ref.bytes > WORLD_BLOCK_BYTES) throw worldStorageError('WORLD_BLOCK_BUDGET');
      const bytes = await reader.take(ref.bytes);
      if (hashBytes(bytes) !== ref.hash) throw worldStorageError('WORLD_INTEGRITY_MISMATCH');
      await storage.put(bytes, { signal }); visited.add(ref.hash);
    }
    await reader.end();
    // Validate all declared graph edges, including linked packages, before returning a usable root.
    const pending = [header.root], checked = new Set();
    while (pending.length) {
      const ref = pending.pop(); if (checked.has(ref.hash)) continue;
      if (!header.linked && !visited.has(ref.hash)) throw worldStorageError('WORLD_DEPENDENCY_MISSING');
      checked.add(ref.hash); await storage.read(ref, { signal });
      if (ref.kind) pending.push(...(await storage.node(ref, { signal })).refs);
    }
    if (!header.linked && checked.size !== visited.size) throw worldStorageError('WORLD_UNREFERENCED_BLOCK');
    return header;
  } finally { await reader.source.return?.(); }
}
