import * as THREE from 'three/webgpu';
import { Fn, If, float, instanceIndex, positionLocal, select, storage, uint, vec3 } from 'three/tsl';

export const DEFAULT_RESIDENT_CULL_COUNT = 4096;
export const DEFAULT_RESIDENT_CULL_RADIUS = 18;
export const DEFAULT_RESIDENT_CULL_WORKGROUP_SIZE = 64;

export function createDeterministicCullPositions(count = DEFAULT_RESIDENT_CULL_COUNT) {
  const n = Math.max(1, Math.trunc(Number(count) || DEFAULT_RESIDENT_CULL_COUNT));
  const values = new Float32Array(n * 3);
  for (let i = 0; i < n; i += 1) {
    const angle = i * 2.399963229728653;
    const ring = 2 + (i % 97) * 0.42;
    values[i * 3] = Math.cos(angle) * ring;
    values[i * 3 + 1] = ((i % 31) - 15) * 0.35;
    values[i * 3 + 2] = Math.sin(angle) * ring;
  }
  return values;
}

export function cpuCullCount(positions, origin = [0, 0, 0], radius = DEFAULT_RESIDENT_CULL_RADIUS) {
  const radiusSq = Number(radius) ** 2;
  let visible = 0;
  for (let i = 0; i < positions.length; i += 3) {
    const dx = positions[i] - origin[0];
    const dy = positions[i + 1] - origin[1];
    const dz = positions[i + 2] - origin[2];
    if (dx * dx + dy * dy + dz * dz <= radiusSq) visible += 1;
  }
  return visible;
}

export async function createGPUResidentCullingProbe(renderer, {
  count = DEFAULT_RESIDENT_CULL_COUNT,
  radius = DEFAULT_RESIDENT_CULL_RADIUS,
  workgroupSize = DEFAULT_RESIDENT_CULL_WORKGROUP_SIZE,
  origin = [0, 0, 0]
} = {}) {
  if (!renderer) throw new TypeError('GPU resident culling probe requires a renderer');
  if (renderer.backend?.isWebGPUBackend !== true) {
    return Object.freeze({ supported: false, backend: renderer.backend?.isWebGLBackend ? 'webgl2' : 'unknown', reason: 'webgpu-required' });
  }

  const device = renderer.backend.device;
  const maxStorageBytes = Number(device?.limits?.maxStorageBufferBindingSize) || (128 * 1024 * 1024);
  const maxCountFromStorage = Math.floor(maxStorageBytes / 16);
  const n = Math.max(1, Math.min(maxCountFromStorage, 65536, Math.trunc(Number(count) || DEFAULT_RESIDENT_CULL_COUNT)));
  const maxInvocations = Number(device?.limits?.maxComputeInvocationsPerWorkgroup) || DEFAULT_RESIDENT_CULL_WORKGROUP_SIZE;
  const groupSize = Math.max(1, Math.min(maxInvocations, Math.trunc(Number(workgroupSize) || DEFAULT_RESIDENT_CULL_WORKGROUP_SIZE)));
  const r = Math.max(0, Number(radius) || DEFAULT_RESIDENT_CULL_RADIUS);
  const ox = Number(origin?.[0]) || 0;
  const oy = Number(origin?.[1]) || 0;
  const oz = Number(origin?.[2]) || 0;

  const positions = createDeterministicCullPositions(n);
  const positionAttribute = new THREE.StorageBufferAttribute(positions, 3);
  const maskAttribute = new THREE.StorageBufferAttribute(new Uint32Array(n), 1);
  const positionBuffer = storage(positionAttribute, 'vec3', n).toReadOnly();
  const maskBuffer = storage(maskAttribute, 'uint', n);
  const radiusSq = r * r;

  const kernel = Fn(() => {
    const delta = positionBuffer.element(instanceIndex).sub(vec3(float(ox), float(oy), float(oz)));
    const inside = delta.dot(delta).lessThanEqual(float(radiusSq));
    If(inside, () => maskBuffer.element(instanceIndex).assign(uint(1)))
      .Else(() => maskBuffer.element(instanceIndex).assign(uint(0)));
  })().compute(n, [groupSize]);
  kernel.setName?.('agentscape-gpu-resident-culling');

  const geometry = new THREE.BoxGeometry(0.16, 0.16, 0.16);
  const material = new THREE.MeshBasicNodeMaterial({ color: 0xffffff });
  const visible = maskBuffer.element(instanceIndex).greaterThan(uint(0));
  material.positionNode = positionLocal.add(select(visible, vec3(0, 0, 0), vec3(1e6, 1e6, 1e6)));
  const mesh = new THREE.InstancedMesh(geometry, material, n);
  mesh.name = 'WebGPUResidentCullingProbe';
  mesh.frustumCulled = false;

  const matrix = new THREE.Matrix4();
  for (let i = 0; i < n; i += 1) {
    matrix.makeTranslation(positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]);
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
    positionAttribute.dispose?.();
    maskAttribute.dispose?.();
    geometry.dispose();
    material.dispose();
  };

  return Object.freeze({
    supported: true,
    backend: 'webgpu',
    count: n,
    expectedVisible: cpuCullCount(positions, [ox, oy, oz], r),
    radius: r,
    workgroupSize: groupSize,
    dispatchCount: Math.ceil(n / groupSize),
    computeSubmitMs,
    gpuComputeMs,
    mesh,
    maskBuffer,
    dispose
  });
}
