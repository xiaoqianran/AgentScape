import { WebGPURenderer } from 'three/webgpu';

export const RENDERER_MODE = Object.freeze({
  AUTO: 'auto',
  WEBGPU: 'webgpu',
  WEBGL2: 'webgl2'
});

const VALID_MODES = new Set(Object.values(RENDERER_MODE));

export function normalizeRendererMode(value = RENDERER_MODE.AUTO) {
  const text = String(value ?? '').trim().toLowerCase();
  const mode = text === '' ? RENDERER_MODE.AUTO : (text === 'webgl' ? RENDERER_MODE.WEBGL2 : text);
  if (!VALID_MODES.has(mode)) {
    const error = new RangeError(`Unsupported renderer mode: ${value}`);
    error.code = 'RENDERER_MODE_INVALID';
    throw error;
  }
  return mode;
}

export function rendererBackend(renderer) {
  if (renderer?.backend?.isWebGPUBackend === true) return RENDERER_MODE.WEBGPU;
  if (renderer?.backend?.isWebGLBackend === true) return RENDERER_MODE.WEBGL2;
  return 'unknown';
}

export function rendererDiagnostics(renderer, requestedMode = RENDERER_MODE.AUTO) {
  const mode = normalizeRendererMode(requestedMode);
  const backend = rendererBackend(renderer);
  return Object.freeze({
    renderer: renderer?.isWebGPURenderer === true ? 'WebGPURenderer' : renderer?.constructor?.name || 'unknown',
    requestedMode: mode,
    backend,
    fallback: mode === RENDERER_MODE.AUTO && backend === RENDERER_MODE.WEBGL2
  });
}

export async function createRenderer({
  mode = RENDERER_MODE.AUTO,
  antialias = true,
  alpha = false,
  RendererClass = WebGPURenderer
} = {}) {
  const requestedMode = normalizeRendererMode(mode);
  const renderer = new RendererClass({
    antialias: Boolean(antialias),
    alpha: Boolean(alpha),
    forceWebGL: requestedMode === RENDERER_MODE.WEBGL2
  });

  await renderer.init();
  const info = rendererDiagnostics(renderer, requestedMode);

  if (info.backend === 'unknown') {
    renderer.dispose?.();
    const error = new Error('Renderer initialized without a recognized WebGPU/WebGL2 backend');
    error.code = 'RENDERER_BACKEND_UNKNOWN';
    throw error;
  }

  if (requestedMode === RENDERER_MODE.WEBGPU && info.backend !== RENDERER_MODE.WEBGPU) {
    renderer.dispose?.();
    const error = new Error('WebGPU renderer mode was required but Three.js fell back to WebGL2');
    error.code = 'RENDERER_WEBGPU_REQUIRED';
    error.backend = info.backend;
    throw error;
  }

  return { renderer, info };
}