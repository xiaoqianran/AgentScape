import { describe, expect, it } from 'vitest';
import { compareSpatialMasks, cpuDistanceMask, createSpatialProbePositions, runWebGPUSpatialProbe } from '../../core/rendering/WebGPUSpatialProbe.js';

describe('WebGPU spatial probe', () => {
  it('builds deterministic vec3 positions', () => {
    const a = createSpatialProbePositions(8);
    const b = createSpatialProbePositions(8);
    expect([...a]).toEqual([...b]);
    expect(a).toHaveLength(24);
  });

  it('computes a deterministic CPU distance mask', () => {
    const positions = new Float32Array([0, 0, 0, 3, 4, 0, 6, 0, 0]);
    expect([...cpuDistanceMask(positions, { radius: 5 })]).toEqual([1, 1, 0]);
  });

  it('detects spatial mask mismatches', () => {
    expect(compareSpatialMasks(new Uint32Array([1, 0, 1]), new Uint32Array([1, 1, 1]))).toMatchObject({ passed: false, mismatches: 1, firstMismatch: { index: 1, expected: 1, actual: 0 } });
  });

  it('does not run on WebGL2 fallback', async () => {
    await expect(runWebGPUSpatialProbe({ backend: { isWebGLBackend: true } })).resolves.toMatchObject({ supported: false, reason: 'webgpu-required' });
  });
});
