import { describe, expect, it } from 'vitest';
import { PipelineEngine } from '../../world/compiler/PipelineEngine.js';

it('runs named stages in deterministic order and carries state', async () => {
  const pipeline = new PipelineEngine();
  pipeline.register('a', async (s) => { s.artifacts.a = 1; return s; });
  pipeline.register('b', async (s) => { s.artifacts.b = s.artifacts.a + 1; return s; });
  const result = await pipeline.run({ hello: 'world' });
  expect(result.state.artifacts).toEqual({ a: 1, b: 2 });
  expect(result.timeline.map((x) => x.name)).toEqual(['a', 'b']);
});
