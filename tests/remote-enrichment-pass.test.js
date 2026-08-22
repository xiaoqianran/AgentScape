import { expect, it } from 'vitest';
import { RemoteEnrichmentPass } from '../src/compiler/passes/RemoteEnrichmentPass.js';

it('upgrades fallback collision and physics when a heavy provider is configured', async () => {
  const provider = { isConfigured:()=>true, endpoint:'x', run:async()=>({ collision:{strategy:'coacd',colliders:[{shape:'convexHull',vertices:[0,0,0,1,0,0,0,1,0,0,0,1]}]}, physics:{mass:3,friction:.7} }) };
  const context = { sourceName:'x.glb', sourceUrl:'https://x', inspection:{nodes:[],stats:{}}, geometry:{}, semantics:{}, articulation:{candidates:[]}, collision:{strategy:'aabb-fallback'}, physics:{} };
  const result = await new RemoteEnrichmentPass({ provider }).run(context);
  expect(result.collision.strategy).toBe('coacd');
  expect(result.physics.mass).toBe(3);
});
