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
    expect(result.quality.advisory.map((x) => x.code)).toEqual(expect.arrayContaining(['COLLIDER_COARSE','SEMANTIC_LOW_CONFIDENCE','ARTICULATION_CANDIDATE_ONLY']));
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

  it('keeps executable articulation provisional until runtime verification succeeds', async () => {
    const part = { node:'Door', actions:['open','close'], targets:{open:-1,close:0}, physics:{colliders:[{}]}, joint:{type:'revolute'} };
    const unverified = await run({ articulation:{ candidates:[], parts:{door:part} } });
    expect(unverified.quality.advisory.some((x) => x.code === 'ARTICULATION_UNVERIFIED')).toBe(true);
    const verified = await run({ articulation:{ candidates:[], parts:{door:part} }, verification:{articulation:{ok:true}} });
    expect(verified.quality.advisory.some((x) => x.code === 'ARTICULATION_UNVERIFIED')).toBe(false);
  });

  it('keeps provider segmentation/raw grasps explicitly provisional without promoting interaction truth', async () => {
    const result=await run({
      providerEvidence:{levels:{partSegmentation:'provider',partSemantics:'none',grasps:'raw-provider-only'}},
      partSegmentation:{version:1,source:'embodiedgen/p3sam',segments:[{id:'0'}],issues:[],materialization:{status:'materialized'}}
    });
    const codes=result.quality.advisory.map((item)=>item.code);
    expect(codes).toEqual(expect.arrayContaining(['PART_SEMANTICS_UNVERIFIED','PROVIDER_GRASP_RAW_ONLY']));
    expect(result.quality.status).toBe('provisional');
  });

  it('distinguishes unverified grasp descriptors from hash/schema-verified raw or SAPIEN evidence', async () => {
    for (const level of ['raw-provider-unverified','sapien-provider-unverified']) {
      const result=await run({providerEvidence:{levels:{partSegmentation:'none',partSemantics:'none',grasps:level}}});
      expect(result.quality.advisory.map((item)=>item.code)).toContain('PROVIDER_GRASP_UNVERIFIED');
    }
    const sapien=await run({providerEvidence:{levels:{partSegmentation:'none',partSemantics:'none',grasps:'sapien-validated-provider-only'}}});
    expect(sapien.quality.advisory.map((item)=>item.code)).toContain('PROVIDER_GRASP_SAPIEN_ONLY');
  });

  it('keeps face-level segmentation provisional until it is materialized into executable parts', async () => {
    const result=await run({partSegmentation:{version:1,source:'external',segments:[{id:'a'}],issues:[]}});
    expect(result.quality.status).toBe('provisional');
    expect(result.quality.advisory.some((x)=>x.code==='PART_SEGMENTATION_UNMATERIALIZED')).toBe(true);
  });

});
