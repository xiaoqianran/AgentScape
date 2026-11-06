import { IncrementalSha256 } from '../../modules/artifact/IncrementalSha256.js';

export const WORLD_BLOCK_BYTES = 1024 * 1024;
const encoder = new TextEncoder(), decoder = new TextDecoder('utf-8', { fatal: true });
export const worldStorageError = code => Object.assign(new Error(code), { code });
export function checkHash(hash) {
  if (!/^[a-f0-9]{64}$/.test(hash)) throw worldStorageError('WORLD_HASH_INVALID');
  return hash;
}
export const hashBytes = bytes => new IncrementalSha256().update(bytes).digestHex();
export function checkCancelled(signal) { if (signal?.aborted) throw worldStorageError('WORLD_CANCELLED'); }

/** Immutable content-addressed blocks. Backend owns durable bytes, never a world/entity cache. */
export class WorldStorage {
  constructor(backend) {
    if (!backend?.read || !backend?.write) throw new TypeError('WorldStorage requires a block backend');
    this.backend = backend;
  }
  async put(bytes, { signal } = {}) {
    checkCancelled(signal);
    if (!(bytes instanceof Uint8Array) || bytes.length > WORLD_BLOCK_BYTES) throw worldStorageError('WORLD_BLOCK_BUDGET');
    const hash = hashBytes(bytes);
    await this.backend.write(hash, bytes);
    checkCancelled(signal);
    return { hash, bytes: bytes.length };
  }
  async read(ref, { signal } = {}) {
    checkCancelled(signal); checkHash(ref?.hash);
    if (!Number.isSafeInteger(ref.bytes) || ref.bytes < 0 || ref.bytes > WORLD_BLOCK_BYTES) throw worldStorageError('WORLD_BLOCK_BUDGET');
    const bytes = await this.backend.read(ref.hash, ref.bytes);
    checkCancelled(signal);
    if (!(bytes instanceof Uint8Array) || bytes.length !== ref.bytes || hashBytes(bytes) !== ref.hash) throw worldStorageError('WORLD_INTEGRITY_MISMATCH');
    return bytes;
  }
  async putNode(kind, data, refs = [], options = {}) {
    return { ...await this.put(encoder.encode(JSON.stringify({ kind, data, refs })), options), kind };
  }
  async node(ref, options = {}) {
    let node;
    try { node = JSON.parse(decoder.decode(await this.read(ref, options))); }
    catch (error) { if (error.code) throw error; throw worldStorageError('WORLD_NODE_INVALID'); }
    if (!node || node.kind !== ref.kind || !Array.isArray(node.refs) || node.refs.length > 2048) throw worldStorageError('WORLD_NODE_INVALID');
    for (const link of node.refs) {
      checkHash(link?.hash);
      if (!Number.isSafeInteger(link.bytes) || link.bytes < 0 || link.bytes > WORLD_BLOCK_BYTES) throw worldStorageError('WORLD_BLOCK_BUDGET');
    }
    return node;
  }
  /** Page list is immutable; newest page points to its predecessor. No unbounded root index. */
  async writePages(kind, items, { pageSize = 128, signal } = {}) {
    if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 1024) throw worldStorageError('WORLD_PAGE_BUDGET');
    let previous = null, count = 0, page = [];
    const flush = async () => {
      const refs = [...page.flatMap(item => item.resource ? [item.resource] : []), ...(previous ? [previous] : [])];
      previous = await this.putNode(kind, { items: page, previous, count }, refs, { signal });
      page = [];
    };
    for await (const item of items) {
      checkCancelled(signal); page.push(item); count++;
      if (page.length === pageSize) await flush();
    }
    if (page.length) await flush();
    return previous;
  }
  async *pages(ref, kind, options = {}) {
    const visited = new Set();
    while (ref) {
      if (ref.kind !== kind || visited.has(ref.hash)) throw worldStorageError('WORLD_PAGE_INVALID');
      visited.add(ref.hash);
      const node = await this.node(ref, options), { items, previous } = node.data || {};
      if (!Array.isArray(items) || items.length > 1024 || JSON.stringify(node.refs) !== JSON.stringify([...items.flatMap(item => item.resource ? [item.resource] : []), ...(previous ? [previous] : [])])) throw worldStorageError('WORLD_PAGE_INVALID');
      yield items; ref = previous;
    }
  }
  /** Consumes bounded chunks with backpressure. Large producer chunks are rejected before copying. */
  async putResource(source, { format = 'application/octet-stream', signal } = {}) {
    const digest = new IncrementalSha256();
    let size = 0, previous = null, blocks = [], buffer = new Uint8Array(WORLD_BLOCK_BYTES), used = 0;
    const flushIndex = async () => {
      const refs = [...blocks, ...(previous ? [previous] : [])];
      previous = await this.putNode('resource-blocks', { blocks, previous }, refs, { signal }); blocks = [];
    };
    const flushBlock = async () => {
      blocks.push(await this.put(buffer.subarray(0, used), { signal })); used = 0;
      if (blocks.length === 128) await flushIndex();
    };
    for await (const chunk of source) {
      checkCancelled(signal);
      if (!(chunk instanceof Uint8Array) || chunk.length > WORLD_BLOCK_BYTES) throw worldStorageError('WORLD_SOURCE_CHUNK_BUDGET');
      digest.update(chunk); size += chunk.length;
      if (!Number.isSafeInteger(size)) throw worldStorageError('WORLD_SIZE_INVALID');
      let offset = 0;
      while (offset < chunk.length) {
        const take = Math.min(chunk.length - offset, buffer.length - used);
        buffer.set(chunk.subarray(offset, offset + take), used); used += take; offset += take;
        if (used === buffer.length) await flushBlock();
      }
    }
    if (used) await flushBlock();
    if (blocks.length) await flushIndex();
    return this.putNode('resource', { sha256: digest.digestHex(), size, format, blocks: previous }, previous ? [previous] : [], { signal });
  }
  async *resource(ref, options = {}) {
    if (ref?.kind !== 'resource') throw worldStorageError('WORLD_RESOURCE_INVALID');
    const { data, refs } = await this.node(ref, options);
    if (JSON.stringify(refs) !== JSON.stringify(data.blocks ? [data.blocks] : [])) throw worldStorageError('WORLD_RESOURCE_INVALID');
    checkHash(data.sha256);
    if (!Number.isSafeInteger(data.size) || data.size < 0) throw worldStorageError('WORLD_SIZE_INVALID');
    // Only small index descriptors are retained, not resource bytes.
    const pages = [], seen = new Set(); let index = data.blocks;
    while (index) {
      if (index.kind !== 'resource-blocks' || seen.has(index.hash)) throw worldStorageError('WORLD_RESOURCE_INVALID');
      seen.add(index.hash);
      const node = await this.node(index, options);
      if (!Array.isArray(node.data.blocks) || node.data.blocks.length > 128 || JSON.stringify(node.refs) !== JSON.stringify([...node.data.blocks, ...(node.data.previous ? [node.data.previous] : [])])) throw worldStorageError('WORLD_RESOURCE_INVALID');
      pages.push(index); index = node.data.previous;
    }
    let size = 0; const digest = new IncrementalSha256();
    for (const page of pages.reverse()) {
      const node = await this.node(page, options);
      for (const block of node.data.blocks) {
        const bytes = await this.read(block, options); size += bytes.length;
        if (size > data.size) throw worldStorageError('WORLD_SIZE_MISMATCH');
        digest.update(bytes); yield bytes;
      }
    }
    if (size !== data.size || digest.digestHex() !== data.sha256) throw worldStorageError('WORLD_RESOURCE_INTEGRITY');
  }
}

/** File/Blob input, never file.arrayBuffer() on an entire world. */
export async function* blobChunks(blob, { signal } = {}) {
  for (let offset = 0; offset < blob.size; offset += WORLD_BLOCK_BYTES) {
    checkCancelled(signal);
    yield new Uint8Array(await blob.slice(offset, offset + WORLD_BLOCK_BYTES).arrayBuffer());
  }
}
