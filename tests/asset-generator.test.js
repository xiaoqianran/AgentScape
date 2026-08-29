import { expect, it, vi } from 'vitest';
import { HttpAssetGenerator } from '../asset/gateway/HttpAssetGenerator.js';

it('uses a provider-neutral HTTP generator contract', async () => {
  const fetchImpl = vi.fn(async () => ({ ok: true, json: async () => ({ manifest: { id: 'x' } }) }));
  const generator = new HttpAssetGenerator({ endpoint: 'https://generator.test', fetchImpl });
  const result = await generator.generate({ prompt: 'a chair' });
  expect(result.manifest.id).toBe('x');
  expect(fetchImpl).toHaveBeenCalledOnce();
});


it('accepts a raw provider payload for adapter-based admission', async () => {
  const raw={provider:'embodiedgen',asset:{id:'raw-1'}};
  const fetchImpl=vi.fn(async()=>({ok:true,json:async()=>raw}));
  const generator=new HttpAssetGenerator({endpoint:'https://generator.test',fetchImpl});
  await expect(generator.generate({prompt:'a bench',provider:'embodiedgen'})).resolves.toEqual(raw);
});
