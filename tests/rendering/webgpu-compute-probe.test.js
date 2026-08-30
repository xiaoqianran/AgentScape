import { describe, expect, it } from 'vitest';
import { runWebGPUComputeProbe, verifyComputeProbeOutput } from '../../core/rendering/WebGPUComputeProbe.js';

describe('WebGPU compute probe', () => {
  it('verifies the deterministic compute sequence', () => {
    expect(verifyComputeProbeOutput(new Uint32Array([7, 10, 13, 16]), { count: 4 })).toMatchObject({
      passed: true,
      checked: 4,
      mismatches: 0,
      checksum: 46
    });
  });

  it('reports the first incorrect GPU readback value', () => {
    expect(verifyComputeProbeOutput(new Uint32Array([7, 10, 99, 16]), { count: 4 })).toMatchObject({
      passed: false,
      mismatches: 1,
      firstMismatch: { index: 2, expected: 13, actual: 99 }
    });
  });

  it('normalizes verification constants to uint semantics', () => {
    expect(verifyComputeProbeOutput(new Uint32Array([4294967295, 0]), { count: 2, multiplier: 1, bias: -1 })).toMatchObject({
      passed: true,
      mismatches: 0
    });
  });

  it('does not run the WebGPU-only probe on the WebGL2 fallback backend', async () => {
    await expect(runWebGPUComputeProbe({ backend: { isWebGLBackend: true } })).resolves.toEqual({
      supported: false,
      passed: false,
      backend: 'webgl2',
      reason: 'webgpu-required'
    });
  });
});