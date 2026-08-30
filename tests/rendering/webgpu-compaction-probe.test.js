import { describe, expect, it } from 'vitest';
import { createWebGPUCompactionProbe, verifyCompactedIndices } from '../../core/rendering/WebGPUCompactionProbe.js';

describe('WebGPU compaction probe', () => {

  it('validates compacted indices as a set, independent of atomic ordering', () => {
    const positions = new Float32Array([0,0,0, 2,0,0, 10,0,0, 1,0,1]);
    expect(verifyCompactedIndices(new Uint32Array([3,0,1]), positions, [0,0,0], 3)).toEqual({
      passed:true, expectedVisible:3, actualVisible:3, invalid:0, duplicates:0, missing:0
    });
    expect(verifyCompactedIndices(new Uint32Array([0,0,2]), positions, [0,0,0], 3)).toMatchObject({
      passed:false, invalid:1, duplicates:1, missing:2
    });
  });

  it('does not run on WebGL2 fallback', async () => {
    await expect(createWebGPUCompactionProbe({ backend:{ isWebGLBackend:true } })).resolves.toEqual({
      supported:false,
      backend:'webgl2',
      reason:'webgpu-required'
    });
  });
});
