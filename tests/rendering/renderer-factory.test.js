import { describe, expect, it, vi } from 'vitest';
import {
  RENDERER_MODE,
  createRenderer,
  normalizeRendererMode,
  rendererBackend,
  rendererDiagnostics
} from '../../core/rendering/createRenderer.js';
import { RendererProbe } from '../../core/rendering/RendererProbe.js';

class FakeRenderer {
  constructor(parameters = {}) {
    this.parameters = parameters;
    this.isWebGPURenderer = true;
    this.backend = parameters.forceWebGL ? { isWebGLBackend: true } : { isWebGPUBackend: true };
    this.init = vi.fn(async () => this);
    this.dispose = vi.fn();
  }
}

class FallbackRenderer extends FakeRenderer {
  constructor(parameters = {}) {
    super(parameters);
    this.init = vi.fn(async () => {
      this.backend = { isWebGLBackend: true };
      return this;
    });
  }
}

describe('renderer factory', () => {
  it('normalizes explicit renderer modes without browser feature detection', () => {
    expect(normalizeRendererMode()).toBe(RENDERER_MODE.AUTO);
    expect(normalizeRendererMode('WEBGPU')).toBe(RENDERER_MODE.WEBGPU);
    expect(normalizeRendererMode('webgl')).toBe(RENDERER_MODE.WEBGL2);
    expect(() => normalizeRendererMode('canvas2d')).toThrowError(/Unsupported renderer mode/);
  });

  it('initializes WebGPURenderer before returning backend diagnostics', async () => {
    const result = await createRenderer({ RendererClass: FakeRenderer });
    expect(result.renderer.init).toHaveBeenCalledTimes(1);
    expect(result.renderer.parameters).toMatchObject({ antialias: true, alpha: false, trackTimestamp: false, forceWebGL: false });
    expect(result.info).toEqual({
      renderer: 'WebGPURenderer',
      requestedMode: 'auto',
      backend: 'webgpu',
      fallback: false
    });
  });

  it('uses the WebGPURenderer WebGL2 backend instead of constructing WebGLRenderer', async () => {
    const result = await createRenderer({ mode: 'webgl2', RendererClass: FakeRenderer });
    expect(result.renderer.parameters.forceWebGL).toBe(true);
    expect(rendererBackend(result.renderer)).toBe('webgl2');
    expect(rendererDiagnostics(result.renderer, 'webgl2').backend).toBe('webgl2');
  });


  it('passes timestamp tracking through without changing the renderer backend contract', async () => {
    const result = await createRenderer({ trackTimestamp: true, RendererClass: FakeRenderer });
    expect(result.renderer.parameters.trackTimestamp).toBe(true);
    expect(result.info.backend).toBe('webgpu');
  });

  it('samples GPU time at a bounded cadence and surfaces renderer health', async () => {
    const previousDeviceLost = vi.fn();
    const previousError = vi.fn();
    const renderer = {
      isWebGPURenderer: true,
      backend: {
        isWebGPUBackend: true,
        trackTimestamp: true,
        compatibilityMode: false,
        device: {
          features: new Set(['timestamp-query', 'texture-compression-bc']),
          limits: { maxTextureDimension2D: 8192, maxBindGroups: 4 }
        }
      },
      onDeviceLost: previousDeviceLost,
      onError: previousError,
      resolveTimestampsAsync: vi.fn(async () => 1.25)
    };
    const onDeviceLost = vi.fn();
    const onError = vi.fn();
    const probe = new RendererProbe(renderer, { requestedMode: 'webgpu', timingIntervalMs: 1000, onDeviceLost, onError });

    probe.afterRender(1000);
    await probe.timingPromise;
    probe.afterRender(1100);
    expect(renderer.resolveTimestampsAsync).toHaveBeenCalledTimes(1);
    expect(probe.snapshot()).toMatchObject({
      backend: 'webgpu',
      health: 'ready',
      gpuTiming: true,
      gpuTimeMs: 1.25,
      timestampSupported: true,
      compatibilityMode: false
    });

    renderer.onError({ api: 'WebGPU', type: 'GPUValidationError', message: 'bad binding' });
    expect(previousError).toHaveBeenCalledOnce();
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ type: 'GPUValidationError' }));
    expect(probe.snapshot().health).toBe('degraded');

    renderer.onDeviceLost({ api: 'WebGPU', reason: 'unknown', message: 'device reset' });
    expect(previousDeviceLost).toHaveBeenCalledOnce();
    expect(onDeviceLost).toHaveBeenCalledWith(expect.objectContaining({ type: 'device-lost' }));
    expect(probe.snapshot().health).toBe('lost');

    probe.dispose();
    expect(renderer.onDeviceLost).toBe(previousDeviceLost);
    expect(renderer.onError).toBe(previousError);
  });

  it('fails clearly when WebGPU is required but Three falls back to WebGL2', async () => {
    await expect(createRenderer({ mode: 'webgpu', RendererClass: FallbackRenderer }))
      .rejects.toMatchObject({ code: 'RENDERER_WEBGPU_REQUIRED', backend: 'webgl2' });
  });
});