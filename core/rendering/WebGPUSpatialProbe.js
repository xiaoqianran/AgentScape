import { StorageBufferAttribute } from 'three/webgpu';
import { Fn, If, dot, float, instanceIndex, storage, uint, vec3 } from 'three/tsl';

export const DEFAULT_SPATIAL_PROBE_COUNT = 4096;
export const DEFAULT_SPATIAL_PROBE_RADIUS = 18;
export const DEFAULT_SPATIAL_PROBE_WORKGROUP_SIZE = 64;

export function createSpatialProbePositions(count = DEFAULT_SPATIAL_PROBE_COUNT) {
  const n = Math.max(1, Math.trunc(Number(count) || DEFAULT_SPATIAL_PROBE_COUNT));
  const values = new Float32Array(n * 3);
  for (let i = 0; i < n; i += 1) {
    values[i * 3] = ((i * 17) % 127) - 63;
    values[i * 3 + 1] = ((i * 29) % 31) - 15;
    values[i * 3 + 2] = ((i * 43) % 113) - 56;
  }
  return values;
}

export function cpuDistanceMask(positions, { origin = [0, 0, 0], radius = DEFAULT_SPATIAL_PROBE_RADIUS } = {}) {
  if (!(positions instanceof Float32Array) || positions.length % 3 !== 0) throw new TypeError('Spatial probe positions must be a vec3 Float32Array');
  const [ox, oy, oz] = origin.map(Number);
  const r2 = Number(radius) ** 2;
  const mask = new Uint32Array(positions.length / 3);
  for (let i = 0; i < mask.length; i += 1) {
    const dx = positions[i * 3] - ox;
    const dy = positions[i * 3 + 1] - oy;
    const dz = positions[i * 3 + 2] - oz;
    mask[i] = dx * dx + dy * dy + dz * dz <= r2 ? 1 : 0;
  }
  return mask;
}

export function compareSpatialMasks(actual, expected) {
  const count = Math.min(actual?.length || 0, expected?.length || 0);
  let mismatches = Math.abs((actual?.length || 0) - (expected?.length || 0));
  let firstMismatch = null;
  let matches = 0;
  for (let i = 0; i < count; i += 1) {
    if (Number(actual[i]) === Number(expected[i])) matches += 1;
    else {
      mismatches += 1;
      firstMismatch ||= { index: i, expected: Number(expected[i]), actual: Number(actual[i]) };
    }
  }
  return Object.freeze({ passed: mismatches === 0, checked: count, matches, mismatches, firstMismatch });
}

export async function runWebGPUSpatialProbe(renderer, {
  count = DEFAULT_SPATIAL_PROBE_COUNT,
  origin = [0, 0, 0],
  radius = DEFAULT_SPATIAL_PROBE_RADIUS,
  workgroupSize = DEFAULT_SPATIAL_PROBE_WORKGROUP_SIZE
} = {}) {
  if (!renderer) throw new TypeError('WebGPU spatial probe requires a renderer');
  if (renderer.backend?.isWebGPUBackend !== true) return Object.freeze({ supported: false, passed: false, backend: renderer.backend?.isWebGLBackend ? 'webgl2' : 'unknown', reason: 'webgpu-required' });

  const n = Math.max(1, Math.min(65536, Math.trunc(Number(count) || DEFAULT_SPATIAL_PROBE_COUNT)));
  const positions = createSpatialProbePositions(n);
  const cpuStartedAt = performance.now();
  const expected = cpuDistanceMask(positions, { origin, radius });
  const cpuReferenceMs = performance.now() - cpuStartedAt;
  const positionAttribute = new StorageBufferAttribute(positions, 3);
  const maskAttribute = new StorageBufferAttribute(n, 1, Uint32Array);
  const positionBuffer = storage(positionAttribute, 'vec3', n).toReadOnly();
  const maskBuffer = storage(maskAttribute, 'uint', n);
  const [ox, oy, oz] = origin.map(Number);
  const radiusSq = Number(radius) ** 2;
  const maxInvocations = Number(renderer.backend?.device?.limits?.maxComputeInvocationsPerWorkgroup) || DEFAULT_SPATIAL_PROBE_WORKGROUP_SIZE;
  const wg = Math.max(1, Math.min(maxInvocations, Math.trunc(Number(workgroupSize) || DEFAULT_SPATIAL_PROBE_WORKGROUP_SIZE)));

  const kernel = Fn(() => {
    const delta = positionBuffer.element(instanceIndex).sub(vec3(float(ox), float(oy), float(oz)));
    const inside = dot(delta, delta).lessThanEqual(float(radiusSq));
    If(inside, () => maskBuffer.element(instanceIndex).assign(uint(1))).Else(() => maskBuffer.element(instanceIndex).assign(uint(0)));
  })().compute(n, [wg]);
  kernel.setName?.('agentscape-webgpu-spatial-probe');

  const startedAt = performance.now();
  try {
    const computeStartedAt = performance.now();
    await renderer.computeAsync(kernel);
    const computeSubmitMs = performance.now() - computeStartedAt;
    let gpuComputeMs = null;
    if (renderer.backend?.trackTimestamp) {
      const duration = await renderer.resolveTimestampsAsync?.('compute');
      if (Number.isFinite(duration)) gpuComputeMs = duration;
    }
    const readbackStartedAt = performance.now();
    const readback = await renderer.getArrayBufferAsync(maskAttribute);
    const readbackMs = performance.now() - readbackStartedAt;
    const actual = new Uint32Array(readback, 0, n);
    const verification = compareSpatialMasks(actual, expected);
    const visible = actual.reduce((sum, value) => sum + Number(value), 0);
    return Object.freeze({ supported: true, passed: verification.passed, backend: 'webgpu', count: n, visible, radius: Number(radius), workgroupSize: wg, dispatchCount: Math.ceil(n / wg), cpuReferenceMs, computeSubmitMs, readbackMs, gpuComputeMs, elapsedMs: performance.now() - startedAt, verification });
  } finally {
    kernel.dispose?.();
    positionAttribute.dispose();
    maskAttribute.dispose();
  }
}
