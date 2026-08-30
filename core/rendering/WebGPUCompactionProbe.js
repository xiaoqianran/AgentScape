import * as THREE from 'three/webgpu';
import { Fn, If, atomicAdd, atomicLoad, atomicStore, float, instanceIndex, positionLocal, storage, uint, vec3 } from 'three/tsl';
import { createDeterministicCullPositions, cpuCullCount } from './WebGPUResidentCullingProbe.js';

export const DEFAULT_COMPACTION_COUNT = 4096;
export const DEFAULT_COMPACTION_RADIUS = 18;
export const DEFAULT_COMPACTION_WORKGROUP_SIZE = 64;


export function verifyCompactedIndices(actualIndices, positions, origin = [0, 0, 0], radius = DEFAULT_COMPACTION_RADIUS) {
  const expected = new Set();
  const r2 = Number(radius) ** 2;
  for (let i = 0; i < positions.length / 3; i += 1) {
    const dx = positions[i * 3] - origin[0];
    const dy = positions[i * 3 + 1] - origin[1];
    const dz = positions[i * 3 + 2] - origin[2];
    if (dx * dx + dy * dy + dz * dz <= r2) expected.add(i);
  }
  const actual = new Set();
  let duplicates = 0;
  let invalid = 0;
  for (const raw of actualIndices || []) {
    const index = Number(raw);
    if (!Number.isInteger(index) || index < 0 || index >= positions.length / 3 || !expected.has(index)) { invalid += 1; continue; }
    if (actual.has(index)) duplicates += 1;
    actual.add(index);
  }
  let missing = 0;
  for (const index of expected) if (!actual.has(index)) missing += 1;
  return Object.freeze({
    passed: invalid === 0 && duplicates === 0 && missing === 0 && actual.size === expected.size,
    expectedVisible: expected.size,
    actualVisible: actual.size,
    invalid,
    duplicates,
    missing
  });
}

export async function createWebGPUCompactionProbe(renderer, {
  count = DEFAULT_COMPACTION_COUNT,
  radius = DEFAULT_COMPACTION_RADIUS,
  workgroupSize = DEFAULT_COMPACTION_WORKGROUP_SIZE,
  origin = [0, 0, 0]
} = {}) {
  if (!renderer) throw new TypeError('WebGPU compaction probe requires a renderer');
  if (renderer.backend?.isWebGPUBackend !== true) {
    return Object.freeze({ supported:false, backend:renderer.backend?.isWebGLBackend ? 'webgl2' : 'unknown', reason:'webgpu-required' });
  }

  const device = renderer.backend.device;
  const maxStorageBytes = Number(device?.limits?.maxStorageBufferBindingSize) || 128 * 1024 * 1024;
  const maxCountFromStorage = Math.max(1, Math.floor(maxStorageBytes / 20));
  const n = Math.max(1, Math.min(65536, maxCountFromStorage, Math.trunc(Number(count) || DEFAULT_COMPACTION_COUNT)));
  const maxInvocations = Number(device?.limits?.maxComputeInvocationsPerWorkgroup) || DEFAULT_COMPACTION_WORKGROUP_SIZE;
  const groupSize = Math.max(1, Math.min(maxInvocations, Math.trunc(Number(workgroupSize) || DEFAULT_COMPACTION_WORKGROUP_SIZE)));
  const r = Math.max(0, Number(radius) || DEFAULT_COMPACTION_RADIUS);
  const ox = Number(origin?.[0]) || 0;
  const oy = Number(origin?.[1]) || 0;
  const oz = Number(origin?.[2]) || 0;

  const positions = createDeterministicCullPositions(n);
  const positionAttribute = new THREE.StorageBufferAttribute(positions, 3);
  const visibleIndexAttribute = new THREE.StorageBufferAttribute(new Uint32Array(n), 1);
  const counterAttribute = new THREE.StorageBufferAttribute(new Uint32Array(1), 1);

  const geometry = new THREE.BoxGeometry(0.16, 0.16, 0.16);
  const indexCount = geometry.index?.count || 0;
  if (!indexCount) throw new Error('Compaction probe requires indexed geometry');
  const indirect = new THREE.IndirectStorageBufferAttribute(new Uint32Array([indexCount, 0, 0, 0, 0]), 5);
  geometry.setIndirect(indirect);

  const positionsBuffer = storage(positionAttribute, 'vec3', n).toReadOnly();
  const visibleIndices = storage(visibleIndexAttribute, 'uint', n);
  const counter = storage(counterAttribute, 'uint', 1).toAtomic();
  const indirectBuffer = storage(indirect, 'uint', 5);
  const radiusSq = r * r;

  const resetKernel = Fn(() => {
    atomicStore(counter.element(uint(0)), uint(0));
    indirectBuffer.element(uint(0)).assign(uint(indexCount));
    indirectBuffer.element(uint(1)).assign(uint(0));
    indirectBuffer.element(uint(2)).assign(uint(0));
    indirectBuffer.element(uint(3)).assign(uint(0));
    indirectBuffer.element(uint(4)).assign(uint(0));
  })().compute(1);
  resetKernel.setName?.('agentscape-compaction-reset');

  const compactKernel = Fn(() => {
    const delta = positionsBuffer.element(instanceIndex).sub(vec3(float(ox), float(oy), float(oz)));
    const inside = delta.dot(delta).lessThanEqual(float(radiusSq));
    If(inside, () => {
      const slot = atomicAdd(counter.element(uint(0)), uint(1)).toVar();
      visibleIndices.element(slot).assign(instanceIndex);
    });
  })().compute(n, [groupSize]);
  compactKernel.setName?.('agentscape-compaction-filter');

  const finalizeKernel = Fn(() => {
    indirectBuffer.element(uint(1)).assign(atomicLoad(counter.element(uint(0))));
  })().compute(1);
  finalizeKernel.setName?.('agentscape-compaction-finalize');

  const material = new THREE.MeshBasicNodeMaterial({ color:0x86efac });
  const sourceIndex = visibleIndices.element(instanceIndex);
  material.positionNode = positionLocal.add(positionsBuffer.element(sourceIndex));
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'WebGPUCompactionProbe';
  mesh.frustumCulled = false;

  const startedAt = performance.now();
  await renderer.computeAsync(resetKernel);
  await renderer.computeAsync(compactKernel);
  await renderer.computeAsync(finalizeKernel);
  const computeSubmitMs = performance.now() - startedAt;

  let gpuComputeMs = null;
  if (renderer.backend.trackTimestamp) {
    const duration = await renderer.resolveTimestampsAsync?.('compute');
    if (Number.isFinite(duration)) gpuComputeMs = duration;
  }

  const validationStartedAt = performance.now();
  const indirectReadback = new Uint32Array(await renderer.getArrayBufferAsync(indirect));
  const actualVisible = Number(indirectReadback[1] || 0);
  const indicesReadback = new Uint32Array(await renderer.getArrayBufferAsync(visibleIndexAttribute));
  const compactedIndices = indicesReadback.subarray(0, Math.min(actualVisible, n));
  const verification = verifyCompactedIndices(compactedIndices, positions, [ox, oy, oz], r);
  const validationReadbackMs = performance.now() - validationStartedAt;

  let disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    resetKernel.dispose?.();
    compactKernel.dispose?.();
    finalizeKernel.dispose?.();
    positionAttribute.dispose?.();
    visibleIndexAttribute.dispose?.();
    counterAttribute.dispose?.();
    indirect.dispose?.();
    geometry.dispose();
    material.dispose();
  };

  return Object.freeze({
    supported:true,
    backend:'webgpu',
    count:n,
    expectedVisible:cpuCullCount(positions, [ox, oy, oz], r),
    actualVisible,
    passed:verification.passed,
    verification,
    validationReadbackMs,
    radius:r,
    workgroupSize:groupSize,
    dispatchCount:Math.ceil(n / groupSize),
    computeSubmitMs,
    gpuComputeMs,
    mesh,
    visibleIndices,
    indirect,
    dispose
  });
}
