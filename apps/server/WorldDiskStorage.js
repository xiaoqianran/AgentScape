import { mkdir, open, lstat, rename, unlink } from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { checkHash, hashBytes, WORLD_BLOCK_BYTES, worldStorageError } from '../../application/scene/WorldStorage.js';

/** Flat, content-addressed directory. No paths from imported files ever reach the filesystem. */
export class WorldDiskStorage {
  constructor(directory) { this.directory = path.resolve(directory); }
  async initialize() {
    await mkdir(this.directory, { recursive: true });
    const info = await lstat(this.directory);
    if (!info.isDirectory() || info.isSymbolicLink()) throw worldStorageError('WORLD_DIRECTORY_INVALID');
    return this;
  }
  async read(hash, expectedBytes) {
    const file = path.join(this.directory, checkHash(hash));
    const info = await lstat(file);
    if (!info.isFile() || info.isSymbolicLink() || info.size !== expectedBytes || info.size > WORLD_BLOCK_BYTES) throw worldStorageError('WORLD_SIZE_MISMATCH');
    const handle = await open(file, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
    try {
      const stat = await handle.stat();
      if (stat.size !== expectedBytes) throw worldStorageError('WORLD_SIZE_MISMATCH');
      const bytes = new Uint8Array(expectedBytes);
      let offset = 0;
      while (offset < bytes.length) {
        const { bytesRead } = await handle.read(bytes, offset, bytes.length - offset, offset);
        if (!bytesRead) throw worldStorageError('WORLD_TRUNCATED');
        offset += bytesRead;
      }
      if ((await handle.stat()).size !== expectedBytes) throw worldStorageError('WORLD_SIZE_MISMATCH');
      return bytes;
    } finally { await handle.close(); }
  }
  async write(hash, bytes) {
    checkHash(hash);
    if (bytes.length > WORLD_BLOCK_BYTES || hashBytes(bytes) !== hash) throw worldStorageError('WORLD_INTEGRITY_MISMATCH');
    const file = path.join(this.directory, hash);
    try {
      const existing = await this.read(hash, bytes.length);
      if (hashBytes(existing) !== hash) throw worldStorageError('WORLD_INTEGRITY_MISMATCH');
      return;
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    const temporary = path.join(this.directory, `.pending-${randomUUID()}`);
    const handle = await open(temporary, 'wx', 0o600);
    try {
      await handle.writeFile(bytes); await handle.sync(); await handle.close();
      await rename(temporary, file);
    } finally { await handle.close().catch(() => {}); await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
  }
}
