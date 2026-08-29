import { expect, it } from 'vitest';
import { RemoteEnrichmentPass } from '../../asset/compiler/passes/RemoteEnrichmentPass.js';

it('upgrades fallback collision and physics when a heavy provider is configured', async () => {
  const provider = { isConfigured:()=>true, endpoint:'x', run:async()=>({ collision:{strategy:'coacd',colliders:[{shape:'convexHull',vertices:[0,0,0,1,0,0,0,1,0,0,0,1]}]}, physics:{mass:3,friction:.7}, geometry:{watertight:false,windingConsistent:true,components:2}, partSegmentation:{version:1,source:'external',faceCount:10,segments:[{id:0,faceCount:10}]} }) };
  const context = { sourceName:'x.glb', sourceUrl:'https://x', inspection:{nodes:[],stats:{}}, geometry:{}, semantics:{}, articulation:{candidates:[]}, collision:{strategy:'aabb-fallback'}, physics:{} };
  const result = await new RemoteEnrichmentPass({ provider }).run(context);
  expect(result.collision.strategy).toBe('coacd');
  expect(result.physics.mass).toBe(3);
  expect(result.meshQuality).toEqual({watertight:false,windingConsistent:true,components:2});
  expect(result.partSegmentation.source).toBe('external');
});


it('keeps deterministic fallback when the optional provider fails', async () => {
  const provider = { isConfigured:()=>true, endpoint:'x', run:async()=>{ throw new Error('offline'); } };
  const fallback = { strategy:'aabb-fallback', quality:'coarse', colliders:[] };
  const context = { sourceName:'x.glb', sourceUrl:'https://x', inspection:{nodes:[],stats:{}}, geometry:{}, semantics:{}, articulation:{candidates:[]}, collision:fallback };
  const result = await new RemoteEnrichmentPass({ provider }).run(context);
  expect(result.collision).toBe(fallback);
  expect(result.enrichment).toMatchObject({ skipped:true, error:'offline' });
});
