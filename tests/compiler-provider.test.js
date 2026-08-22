import { expect, it, vi } from 'vitest';
import { HttpCompilerProvider } from '../src/compiler/providers/HttpCompilerProvider.js';

it('uses a stage-based provider contract for heavy compiler passes', async () => {
  const fetchImpl = vi.fn(async () => ({ ok:true, json:async () => ({ physics:{mass:2} }) }));
  const provider = new HttpCompilerProvider({ endpoint:'https://compiler.test', fetchImpl });
  const result = await provider.run('enrich', { geometry:{} });
  expect(result.physics.mass).toBe(2);
  const body = JSON.parse(fetchImpl.mock.calls[0][1].body);
  expect(body.stage).toBe('enrich');
});
