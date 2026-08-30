import { rendererDiagnostics } from './createRenderer.js';

const WEBGPU_LIMIT_KEYS = Object.freeze([
  'maxTextureDimension2D',
  'maxBindGroups',
  'maxBufferSize',
  'maxUniformBufferBindingSize',
  'maxStorageBufferBindingSize',
  'maxComputeWorkgroupStorageSize',
  'maxComputeInvocationsPerWorkgroup'
]);

const scalar = (value) => typeof value === 'bigint'
  ? (value <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(value) : value.toString())
  : value;

function deviceDiagnostics(renderer) {
  const backend = renderer?.backend;
  if (backend?.isWebGPUBackend !== true) {
    return {
      compatibilityMode: null,
      timestampSupported: Boolean(backend?.disjoint),
      features: [],
      limits: {}
    };
  }

  const device = backend.device;
  const limits = {};
  for (const key of WEBGPU_LIMIT_KEYS) {
    const value = device?.limits?.[key];
    if (value != null) limits[key] = scalar(value);
  }

  return {
    compatibilityMode: backend.compatibilityMode === true,
    timestampSupported: Boolean(device?.features?.has?.('timestamp-query')),
    features: device?.features ? [...device.features].map(String).sort() : [],
    limits
  };
}

export class RendererProbe {
  constructor(renderer, {
    requestedMode = 'auto',
    timingIntervalMs = 1000,
    onDeviceLost = null,
    onError = null
  } = {}) {
    if (!renderer) throw new TypeError('RendererProbe requires a renderer');
    this.renderer = renderer;
    this.info = rendererDiagnostics(renderer, requestedMode);
    this.device = deviceDiagnostics(renderer);
    this.health = 'ready';
    this.lastError = null;
    this.gpuTimeMs = null;
    this.timingIntervalMs = Math.max(250, Number(timingIntervalMs) || 1000);
    this.nextTimingAt = 0;
    this.timingPromise = null;
    this.onDeviceLost = typeof onDeviceLost === 'function' ? onDeviceLost : null;
    this.onError = typeof onError === 'function' ? onError : null;
    this.previousDeviceLost = renderer.onDeviceLost;
    this.previousError = renderer.onError;

    renderer.onDeviceLost = (detail) => {
      this.previousDeviceLost?.call(renderer, detail);
      this.health = 'lost';
      this.lastError = normalizeRendererError(detail, 'device-lost');
      this.onDeviceLost?.(this.lastError);
    };
    renderer.onError = (detail) => {
      this.previousError?.call(renderer, detail);
      if (this.health !== 'lost') this.health = 'degraded';
      this.lastError = normalizeRendererError(detail, 'backend-error');
      this.onError?.(this.lastError);
    };
  }

  afterRender(timestamp = 0) {
    if (!this.renderer?.backend?.trackTimestamp || this.health === 'lost') return;
    if (this.timingPromise || timestamp < this.nextTimingAt) return;
    this.nextTimingAt = timestamp + this.timingIntervalMs;
    this.timingPromise = Promise.resolve(this.renderer.resolveTimestampsAsync?.('render'))
      .then((value) => {
        if (Number.isFinite(value)) this.gpuTimeMs = value;
      })
      .catch((error) => {
        this.lastError = normalizeRendererError(error, 'timestamp-error');
      })
      .finally(() => { this.timingPromise = null; });
  }

  snapshot() {
    return Object.freeze({
      ...this.info,
      health: this.health,
      gpuTiming: Boolean(this.renderer?.backend?.trackTimestamp),
      gpuTimeMs: this.gpuTimeMs,
      compatibilityMode: this.device.compatibilityMode,
      timestampSupported: this.device.timestampSupported,
      features: [...this.device.features],
      limits: { ...this.device.limits },
      lastError: this.lastError ? { ...this.lastError } : null
    });
  }

  dispose() {
    if (!this.renderer) return;
    this.renderer.onDeviceLost = this.previousDeviceLost;
    this.renderer.onError = this.previousError;
    this.renderer = null;
  }
}

function normalizeRendererError(detail, fallbackType) {
  return Object.freeze({
    type: String(detail?.type || fallbackType),
    api: detail?.api ? String(detail.api) : null,
    reason: detail?.reason ? String(detail.reason) : null,
    message: String(detail?.message || detail?.error?.message || detail || 'Unknown renderer error')
  });
}
