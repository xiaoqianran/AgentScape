import { checkHash, WORLD_BLOCK_BYTES, worldStorageError } from './WorldStorage.js';

/** Browser File System Access / OPFS backend. Directory handles cannot represent symbolic links. */
export class WorldDirectory {
  constructor(directory) { this.directory = directory; }
  async read(hash, expectedBytes) {
    checkHash(hash);
    const file = await (await this.directory.getFileHandle(hash)).getFile();
    if (file.size !== expectedBytes || file.size > WORLD_BLOCK_BYTES) throw worldStorageError('WORLD_SIZE_MISMATCH');
    return new Uint8Array(await file.arrayBuffer());
  }
  async write(hash, bytes) {
    checkHash(hash);
    // Content is verified by WorldStorage; writes finish before roots may be published.
    const file = await this.directory.getFileHandle(hash, { create: true });
    const writer = await file.createWritable();
    try { await writer.write(bytes); await writer.close(); }
    catch (error) { await writer.abort().catch(() => {}); throw error; }
  }
}
