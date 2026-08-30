import { describe, expect, it, vi } from 'vitest';
import {
  RENDERER_MODE,
  createRenderer,
  normalizeRendererMode,
  rendererBackend,
  rendererDiagnostics
} from '../../core/rendering/createRenderer.js';

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
    expect(result.renderer.parameters).toMatchObject({ antialias: true, alpha: false, forceWebGL: false });
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

  it('fails clearly when WebGPU is required but Three falls back to WebGL2', async () => {
    await expect(createRenderer({ mode: 'webgpu', RendererClass: FallbackRenderer }))
      .rejects.toMatchObject({ code: 'RENDERER_WEBGPU_REQUIRED', backend: 'webgl2' });
  });
});