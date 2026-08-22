import { describe, expect, it } from 'vitest';
import { CompileQualityPass } from '../src/compiler/passes/CompileQualityPass.js';

const run = (overrides = {}) => new CompileQualityPass().run({
  geometry: { warnings: [] },
  collision: { quality: 'convex-decomposition' },
  semantics: { confidence: 0.9 },
  articulation: { candidates: [], parts: {} },
  ...overrides
});

describe('CompileQualityPass', () => {
  it('marks clean assets ready', async () => {
    expect((await run()).quality.status).toBe('ready');
  });

  it('marks coarse or uncertain assets provisional', async () => {
    const result = await run({ collision: { quality:'coarse' }, semantics:{ confidence:0.2 }, articulation:{ candidates:[{node:'Door'}] } });
    expect(result.quality.status).toBe('provisional');
    expect(result.quality.advisory.map((x) => x.code)).toEqual(expect.arrayContaining(['COLLIDER_COARSE','SEMANTIC_LOW_CONFIDENCE','ARTICULATION_UNVERIFIED']));
  });

  it('rejects hard geometry findings', async () => {
    const result = await run({ geometry:{ warnings:[{ code:'GEOMETRY_EMPTY', severity:'hard' }] } });
    expect(result.quality.status).toBe('rejected');
  });
});
