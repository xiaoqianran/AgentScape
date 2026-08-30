import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  WebGpuPostFxPipeline,
  normalizeWebGpuPostFxOptions,
  supportsWebGpuPostFx
} from '../../core/rendering/WebGpuPostFxPipeline.js';

describe('WebGpuPostFxPipeline', () => {
  it('enables the GTAO + Bloom + FXAA chain only for a WebGPU backend', () => {
    const webgpuRenderer = {
      backend:{ isWebGPUBackend:true },
      toneMapping:THREE.ACESFilmicToneMapping,
      outputColorSpace:THREE.SRGBColorSpace
    };
    const webglRenderer = { backend:{ isWebGLBackend:true } };

    expect(supportsWebGpuPostFx(webgpuRenderer)).toBe(true);
    expect(supportsWebGpuPostFx(webglRenderer)).toBe(false);

    const pipeline = new WebGpuPostFxPipeline({
      renderer:webgpuRenderer,
      scene:new THREE.Scene(),
      camera:new THREE.PerspectiveCamera()
    });

    expect(pipeline.diagnostics()).toEqual({
      enabled:true,
      backend:'webgpu',
      effects:['gtao','bloom','fxaa']
    });
    expect(pipeline.scenePass).toBeTruthy();
    expect(pipeline.aoNode.resolutionScale).toBe(0.5);
    expect(pipeline.aoNode.samples.value).toBe(12);
    pipeline.dispose();
  });

  it('supports explicit effect opt-outs without creating a second renderer path', () => {
    const options = normalizeWebGpuPostFxOptions({
      ao:false,
      bloom:{ strength:0.3, threshold:1.2 },
      fxaa:false
    });

    expect(options.ao.enabled).toBe(false);
    expect(options.bloom).toMatchObject({ enabled:true, strength:0.3, threshold:1.2 });
    expect(options.fxaa.enabled).toBe(false);
  });

  it('stays disabled on the WebGL2 fallback backend', () => {
    const pipeline = new WebGpuPostFxPipeline({
      renderer:{ backend:{ isWebGLBackend:true } },
      scene:new THREE.Scene(),
      camera:new THREE.PerspectiveCamera()
    });

    expect(pipeline.enabled).toBe(false);
    expect(pipeline.pipeline).toBeNull();
    expect(pipeline.render()).toBe(false);
    expect(pipeline.diagnostics()).toEqual({
      enabled:false,
      backend:'unsupported',
      effects:['gtao','bloom','fxaa']
    });
  });
});
