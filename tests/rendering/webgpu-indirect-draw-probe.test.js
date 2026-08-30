import { describe, expect, it } from 'vitest';
import { createWebGPUIndirectDrawProbe, indexedIndirectCommand } from '../../core/rendering/WebGPUIndirectDrawProbe.js';

describe('WebGPU indirect draw probe', () => {
  it('encodes indexed indirect draw parameters', () => {
    expect([...indexedIndirectCommand(36, 256)]).toEqual([36, 256, 0, 0, 0]);
    expect([...indexedIndirectCommand(-1, -2)]).toEqual([0, 0, 0, 0, 0]);
  });

  it('does not run on WebGL2 fallback', async () => {
    await expect(createWebGPUIndirectDrawProbe({ backend:{ isWebGLBackend:true } })).resolves.toEqual({
      supported:false,
      backend:'webgl2',
      reason:'webgpu-required'
    });
  });
});
