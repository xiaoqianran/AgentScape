import { Fn, attributeArray, instanceIndex, uint } from 'three/tsl';

export const DEFAULT_COMPUTE_PROBE_COUNT = 1024;
export const DEFAULT_COMPUTE_WORKGROUP_SIZE = 64;

export function verifyComputeProbeOutput(values, {
  count = values?.length || 0,
  multiplier = 3,
  bias = 7
} = {}) {
  if (!values || typeof values.length !== 'number') throw new TypeError('Compute probe output must be array-like');
  let mismatches = 0;
  let firstMismatch = null;
  let checksum = 0;
  const length = Math.min(count, values.length);
  for (let index = 0; index < length; index += 1) {
    const expected = (index * multiplier + bias) >>> 0;
    const actual = Number(values[index]) >>> 0;
    checksum = (checksum + actual) >>> 0;
    if (actual !== expected) {
      mismatches += 1;
      if (!firstMismatch) firstMismatch = { index, expected, actual };
    }
  }
  if (values.length < count) {
    mismatches += count - values.length;
    firstMismatch ||= { index: values.length, expected: (values.length * multiplier + bias) >>> 0, actual: null };
  }
  return Object.freeze({
    passed: mismatches === 0 && length === count,
    checked: length,
    expectedCount: count,
    mismatches,
    firstMismatch,
    checksum
  });
}

export async function runWebGPUComputeProbe(renderer, {
  count = DEFAULT_COMPUTE_PROBE_COUNT,
  workgroupSize = DEFAULT_COMPUTE_WORKGROUP_SIZE,
  multiplier = 3,
  bias = 7
} = {}) {
  if (!renderer) throw new TypeError('WebGPU compute probe requires a renderer');
  if (renderer.backend?.isWebGPUBackend !== true) {
    return Object.freeze({
      supported: false,
      passed: false,
      backend: renderer.backend?.isWebGLBackend === true ? 'webgl2' : 'unknown',
      reason: 'webgpu-required'
    });
  }

  const storageLimitBytes = Number(renderer.backend?.device?.limits?.maxStorageBufferBindingSize) || 65536 * Uint32Array.BYTES_PER_ELEMENT;
  const maxCountByStorage = Math.max(1, Math.floor(storageLimitBytes / Uint32Array.BYTES_PER_ELEMENT));
  const normalizedCount = Math.max(1, Math.min(65536, maxCountByStorage, Math.trunc(Number(count) || DEFAULT_COMPUTE_PROBE_COUNT)));
  const maxInvocations = Number(renderer.backend?.device?.limits?.maxComputeInvocationsPerWorkgroup) || DEFAULT_COMPUTE_WORKGROUP_SIZE;
  const normalizedWorkgroupSize = Math.max(1, Math.min(maxInvocations, Math.trunc(Number(workgroupSize) || DEFAULT_COMPUTE_WORKGROUP_SIZE)));
  const normalizedMultiplier = Number(multiplier) >>> 0;
  const normalizedBias = Number(bias) >>> 0;
  const output = attributeArray(normalizedCount, 'uint');
  const kernel = Fn(() => {
    output.element(instanceIndex).assign(instanceIndex.mul(uint(normalizedMultiplier)).add(uint(normalizedBias)));
  })().compute(normalizedCount, [normalizedWorkgroupSize]);
  kernel.setName?.('agentscape-webgpu-compute-probe');

  const startedAt = performance.now();
  try {
    await renderer.computeAsync(kernel);
    let gpuComputeMs = null;
    if (renderer.backend?.trackTimestamp) {
      const duration = await renderer.resolveTimestampsAsync?.('compute');
      if (Number.isFinite(duration)) gpuComputeMs = duration;
    }
    const arrayBuffer = await renderer.getArrayBufferAsync(output.value);
    const values = new Uint32Array(arrayBuffer, 0, normalizedCount);
    const verification = verifyComputeProbeOutput(values, {
      count: normalizedCount,
      multiplier: normalizedMultiplier,
      bias: normalizedBias
    });
    return Object.freeze({
      supported: true,
      passed: verification.passed,
      backend: 'webgpu',
      count: normalizedCount,
      bytes: normalizedCount * Uint32Array.BYTES_PER_ELEMENT,
      workgroupSize: normalizedWorkgroupSize,
      dispatchCount: Math.ceil(normalizedCount / normalizedWorkgroupSize),
      gpuComputeMs,
      elapsedMs: performance.now() - startedAt,
      verification
    });
  } finally {
    kernel.dispose?.();
    output.value?.dispose?.();
  }
}