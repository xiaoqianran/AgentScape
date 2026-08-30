import * as THREE from 'three/webgpu';
import { Fn, storage, uint } from 'three/tsl';

export const DEFAULT_INDIRECT_INSTANCE_CAPACITY = 4096;
export const DEFAULT_INDIRECT_VISIBLE_COUNT = 256;

export function indexedIndirectCommand(indexCount, instanceCount) {
  return new Uint32Array([
    Math.max(0, Math.trunc(Number(indexCount) || 0)),
    Math.max(0, Math.trunc(Number(instanceCount) || 0)),
    0,
    0,
    0
  ]);
}

export async function createWebGPUIndirectDrawProbe(renderer, {
  capacity = DEFAULT_INDIRECT_INSTANCE_CAPACITY,
  visibleCount = DEFAULT_INDIRECT_VISIBLE_COUNT
} = {}) {
  if (!renderer) throw new TypeError('WebGPU indirect draw probe requires a renderer');
  if (renderer.backend?.isWebGPUBackend !== true) {
    return Object.freeze({ supported:false, backend:renderer.backend?.isWebGLBackend ? 'webgl2' : 'unknown', reason:'webgpu-required' });
  }

  const maxCapacity = Math.max(1, Math.min(65536, Math.trunc(Number(capacity) || DEFAULT_INDIRECT_INSTANCE_CAPACITY)));
  const targetVisible = Math.max(0, Math.min(maxCapacity, Math.trunc(Number(visibleCount) || DEFAULT_INDIRECT_VISIBLE_COUNT)));
  const geometry = new THREE.BoxGeometry(0.14, 0.14, 0.14);
  const indexCount = geometry.index?.count || 0;
  if (!indexCount) throw new Error('Indirect draw probe requires indexed geometry');

  const indirect = new THREE.IndirectStorageBufferAttribute(indexedIndirectCommand(indexCount, 0), 5);
  geometry.setIndirect(indirect);
  const indirectStorage = storage(indirect, 'uint', 5);
  const kernel = Fn(() => {
    indirectStorage.element(uint(0)).assign(uint(indexCount));
    indirectStorage.element(uint(1)).assign(uint(targetVisible));
    indirectStorage.element(uint(2)).assign(uint(0));
    indirectStorage.element(uint(3)).assign(uint(0));
    indirectStorage.element(uint(4)).assign(uint(0));
  })().compute(1);
  kernel.setName?.('agentscape-indirect-draw-probe');

  const material = new THREE.MeshBasicNodeMaterial({ color:0x7dd3fc });
  const mesh = new THREE.InstancedMesh(geometry, material, maxCapacity);
  mesh.name = 'WebGPUIndirectDrawProbe';
  mesh.frustumCulled = false;

  const matrix = new THREE.Matrix4();
  const side = Math.ceil(Math.sqrt(maxCapacity));
  for (let i = 0; i < maxCapacity; i += 1) {
    const x = (i % side) * 0.24 - side * 0.12;
    const z = Math.floor(i / side) * 0.24 - side * 0.12;
    matrix.makeTranslation(x, 0.2, z);
    mesh.setMatrixAt(i, matrix);
  }
  mesh.instanceMatrix.needsUpdate = true;

  const startedAt = performance.now();
  await renderer.computeAsync(kernel);
  const computeSubmitMs = performance.now() - startedAt;
  let gpuComputeMs = null;
  if (renderer.backend.trackTimestamp) {
    const duration = await renderer.resolveTimestampsAsync?.('compute');
    if (Number.isFinite(duration)) gpuComputeMs = duration;
  }

  let disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    kernel.dispose?.();
    indirect.dispose?.();
    geometry.dispose();
    material.dispose();
  };

  return Object.freeze({
    supported:true,
    backend:'webgpu',
    capacity:maxCapacity,
    visibleCount:targetVisible,
    indexCount,
    indirect,
    mesh,
    computeSubmitMs,
    gpuComputeMs,
    dispose
  });
}
