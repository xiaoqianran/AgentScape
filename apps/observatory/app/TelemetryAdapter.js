import { normalizeDiagnostics } from '../core/DiagnosticsContract.js';

export const renderingInfoForLab = (lab) => lab?.rendererProbe?.snapshot?.() || lab?.left?.rendererProbe?.snapshot?.() || lab?.rendererInfo || lab?.left?.rendererInfo || null;
export const rendererForLab = (lab) => lab?.renderer || lab?.left?.renderer || null;

const featureSummary = (features = []) => {
  const set = new Set(features || []);
  return ['timestamp-query', 'shader-f16', 'subgroups', 'texture-compression-bc'].filter(name => set.has(name)).join(', ') || '—';
};
const formatBytes = (value) => Number.isFinite(value)
  ? (value >= 1024 ** 3 ? `${(value / 1024 ** 3).toFixed(1)} GiB` : `${(value / 1024 ** 2).toFixed(0)} MiB`)
  : '—';
const workgroupSummary = (limits = {}) => {
  const shape = [limits.maxComputeWorkgroupSizeX, limits.maxComputeWorkgroupSizeY, limits.maxComputeWorkgroupSizeZ]
    .map(value => Number.isFinite(value) ? value : '—').join('×');
  return `${shape} / ${Number.isFinite(limits.maxComputeInvocationsPerWorkgroup) ? limits.maxComputeInvocationsPerWorkgroup : '—'}`;
};

export function projectLabTelemetry(data, rendering = null) {
  const metrics = rendering ? {
    ...(data.metrics || {}),
    renderer: rendering.renderer,
    'render backend': rendering.backend,
    'render mode': rendering.requestedMode,
    'render fallback': rendering.fallback,
    'render health': rendering.health || 'ready',
    'gpu timing': rendering.gpuTiming ?? false,
    'gpu render': Number.isFinite(rendering.gpuTimeMs) ? `${rendering.gpuTimeMs.toFixed(3)} ms` : '—',
    'timestamp query': rendering.timestampSupported ?? false,
    'webgpu compatibility': rendering.compatibilityMode ?? '—',
    'webgpu features': featureSummary(rendering.features),
    'storage buffer': formatBytes(rendering.limits?.maxStorageBufferBindingSize),
    'compute workgroup': workgroupSummary(rendering.limits)
  } : (data.metrics || {});
  const diagnostics = normalizeDiagnostics({...data, metrics});
  return {...data, inspector: diagnostics.inspector, assertions: diagnostics.assertions,
    metrics: diagnostics.metrics, diagnostics};
}
