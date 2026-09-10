import { RenderPipeline } from 'three/webgpu';
import { mrt, normalView, output, pass, renderOutput, vec3, vec4 } from 'three/tsl';
import { bloom } from 'three/examples/jsm/tsl/display/BloomNode.js';
import { fxaa } from 'three/examples/jsm/tsl/display/FXAANode.js';
import { ao } from 'three/examples/jsm/tsl/display/GTAONode.js';

const DEFAULT_OPTIONS = Object.freeze({
  ao: Object.freeze({
    enabled: true,
    resolutionScale: 0.5,
    radius: 0.45,
    thickness: 1,
    distanceExponent: 1,
    distanceFallOff: 1,
    scale: 1,
    samples: 12
  }),
  bloom: Object.freeze({
    enabled: true,
    strength: 0.18,
    radius: 0.25,
    threshold: 1.05
  }),
  fxaa: Object.freeze({ enabled: true })
});

const effectOptions = (defaults, value) => {
  if (value === false) return { ...defaults, enabled: false };
  if (value === true || value == null) return { ...defaults };
  return { ...defaults, ...value, enabled: value.enabled !== false };
};

export function normalizeWebGpuPostFxOptions(options = {}) {
  return {
    ao: effectOptions(DEFAULT_OPTIONS.ao, options.ao),
    bloom: effectOptions(DEFAULT_OPTIONS.bloom, options.bloom),
    fxaa: effectOptions(DEFAULT_OPTIONS.fxaa, options.fxaa)
  };
}

export function supportsWebGpuPostFx(renderer) {
  return renderer?.backend?.isWebGPUBackend === true;
}

export class WebGpuPostFxPipeline {
  constructor({ renderer, scene, camera, options = {} } = {}) {
    if (!renderer) throw new TypeError('WebGpuPostFxPipeline requires a renderer');
    if (!scene) throw new TypeError('WebGpuPostFxPipeline requires a scene');
    if (!camera) throw new TypeError('WebGpuPostFxPipeline requires a camera');

    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;
    this.options = normalizeWebGpuPostFxOptions(options);
    this.enabled = supportsWebGpuPostFx(renderer);
    this.pipeline = null;
    this.scenePass = null;
    this.aoNode = null;
    this.bloomNode = null;

    if (this.enabled) this.build();
  }

  build() {
    const scenePass = pass(this.scene, this.camera);
    scenePass.setMRT(mrt({ output, normal: normalView }));

    const sceneColor = scenePass.getTextureNode('output');
    const sceneNormal = scenePass.getTextureNode('normal');
    const sceneDepth = scenePass.getTextureNode('depth');
    let composite = sceneColor;

    if (this.options.ao.enabled) {
      const settings = this.options.ao;
      const aoNode = ao(sceneDepth, sceneNormal, this.camera);
      aoNode.resolutionScale = settings.resolutionScale;
      aoNode.radius.value = settings.radius;
      aoNode.thickness.value = settings.thickness;
      aoNode.distanceExponent.value = settings.distanceExponent;
      aoNode.distanceFallOff.value = settings.distanceFallOff;
      aoNode.scale.value = settings.scale;
      aoNode.samples.value = settings.samples;
      const visibility = aoNode.getTextureNode().r;
      composite = composite.mul(vec4(vec3(visibility), 1));
      this.aoNode = aoNode;
    }

    if (this.options.bloom.enabled) {
      const settings = this.options.bloom;
      this.bloomNode = bloom(sceneColor, settings.strength, settings.radius, settings.threshold);
      composite = composite.add(this.bloomNode);
    }

    const pipeline = new RenderPipeline(this.renderer);
    if (this.options.fxaa.enabled) {
      pipeline.outputColorTransform = false;
      composite = fxaa(renderOutput(composite));
    }
    pipeline.outputNode = composite;

    this.scenePass = scenePass;
    this.pipeline = pipeline;
  }

  render() {
    if (!this.enabled || !this.pipeline) return false;
    this.pipeline.render();
    return true;
  }

  diagnostics() {
    return Object.freeze({
      enabled: this.enabled,
      backend: this.enabled ? 'webgpu' : 'unsupported',
      effects: [
        this.options.ao.enabled ? 'gtao' : null,
        this.options.bloom.enabled ? 'bloom' : null,
        this.options.fxaa.enabled ? 'fxaa' : null
      ].filter(Boolean)
    });
  }

  dispose() {
    this.scenePass?.dispose?.();
    this.scenePass = null;
    this.aoNode?.dispose?.();
    this.aoNode = null;
    this.bloomNode?.dispose?.();
    this.bloomNode = null;
    this.pipeline?.dispose?.();
    this.pipeline = null;
    this.enabled = false;
  }
}
