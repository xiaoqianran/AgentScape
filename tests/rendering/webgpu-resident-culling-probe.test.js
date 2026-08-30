import { describe, expect, it } from 'vitest';
import { cpuCullCount, createDeterministicCullPositions, createGPUResidentCullingProbe } from '../../core/rendering/WebGPUResidentCullingProbe.js';

describe('WebGPU resident culling probe', () => {
  it('generates deterministic positions and CPU visibility counts', () => {
    const a = createDeterministicCullPositions(64);
    const b = createDeterministicCullPositions(64);
    expect([...a]).toEqual([...b]);
    expect(cpuCullCount(a, [0, 0, 0], 18)).toBeGreaterThan(0);
    expect(cpuCullCount(a, [0, 0, 0], 0)).toBe(0);
  });

  it('does not construct a GPU resident probe on WebGL2 fallback', async () => {
    await expect(createGPUResidentCullingProbe({ backend: { isWebGLBackend: true } })).resolves.toEqual({
      supported: false,
      backend: 'webgl2',
      reason: 'webgpu-required'
    });
  });
});
