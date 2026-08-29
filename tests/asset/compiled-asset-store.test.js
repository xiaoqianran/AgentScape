import { expect, it } from 'vitest';
import { CompiledAssetStore } from '../../asset/storage/CompiledAssetStore.js';

it('falls back to in-memory persistence when IndexedDB is unavailable', async () => {
  const store = new CompiledAssetStore({ indexedDBImpl: null });
  await store.put('a', new Uint8Array([1,2,3]), { name:'test' });
  expect(await store.has('a')).toBe(true);
  expect(Array.from((await store.get('a')).bytes)).toEqual([1,2,3]);
  await store.delete('a');
  expect(await store.has('a')).toBe(false);
});
