import { describe, expect, it } from 'vitest';
import { CompileQualityPass } from '../src/compiler/passes/CompileQualityPass.js';

const run = (overrides = {}) => new CompileQualityPass().run({
  geometry: { warnings: [] },
  collision: { quality: 'convex-decomposition' },
  semantics: { confidence: 0.9 },
  articulation: { candidates: [], parts: {} },
  meshQuality: null,
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

  it('marks optional enrichment failure as provisional while retaining the compile result', async () => {
    const result = await run({ enrichment:{ error:'offline' } });
    expect(result.quality.status).toBe('provisional');
    expect(result.quality.advisory.some((x) => x.code === 'ENRICHMENT_FAILED')).toBe(true);
  });

  it('uses heavy mesh diagnostics as advisories instead of inventing browser topology checks', async () => {
    const result = await run({ meshQuality:{ watertight:false, windingConsistent:false, components:3 } });
    expect(result.quality.status).toBe('provisional');
    expect(result.quality.advisory.map((x) => x.code)).toEqual(expect.arrayContaining(['MESH_NOT_WATERTIGHT','MESH_WINDING_INCONSISTENT','MESH_MULTIPLE_COMPONENTS']));
  });

  it('rejects hard geometry findings', async () => {
    const result = await run({ geometry:{ warnings:[{ code:'GEOMETRY_EMPTY', severity:'hard' }] } });
    expect(result.quality.status).toBe('rejected');
  });
});
