import { expect, it, vi } from 'vitest';
import { HttpAssetGenerator } from '../src/assets/gateway/HttpAssetGenerator.js';

it('uses a provider-neutral HTTP generator contract', async () => {
  const fetchImpl = vi.fn(async () => ({ ok: true, json: async () => ({ manifest: { id: 'x' } }) }));
  const generator = new HttpAssetGenerator({ endpoint: 'https://generator.test', fetchImpl });
  const result = await generator.generate({ prompt: 'a chair' });
  expect(result.manifest.id).toBe('x');
  expect(fetchImpl).toHaveBeenCalledOnce();
});
