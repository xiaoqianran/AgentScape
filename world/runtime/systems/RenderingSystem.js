import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { HDRLoader } from 'three/examples/jsm/loaders/HDRLoader.js';
import { createRenderer } from '../../../core/rendering/createRenderer.js';
import { RendererProbe } from '../../../core/rendering/RendererProbe.js';
import { WebGpuPostFxPipeline } from '../../../core/rendering/WebGpuPostFxPipeline.js';
import { loadGaussianSplatVisual } from '../../../core/rendering/loadGaussianSplatVisual.js';

export class RenderingSystem {
  constructor({
    container,
    scene,
    events = null,
    rendererFactory = createRenderer,
    rendererMode = 'auto',
    rendererTiming = false,
    controlsFactory = (camera, domElement) => new OrbitControls(camera, domElement),
    environmentLoader = new HDRLoader(),
    postFxFactory = (options) => new WebGpuPostFxPipeline(options),
    postFxOptions = {},
    generatedVisualLoader = loadGaussianSplatVisual,
    onDeviceLost = null,
    onError = null
  } = {}) {
    if (!container) throw new TypeError('RenderingSystem requires a container');
    if (!scene) throw new TypeError('RenderingSystem requires a scene');
    if (typeof rendererFactory !== 'function') throw new TypeError('RenderingSystem rendererFactory must be a function');
    if (typeof controlsFactory !== 'function') throw new TypeError('RenderingSystem controlsFactory must be a function');
    if (!environmentLoader || typeof environmentLoader.loadAsync !== 'function') throw new TypeError('RenderingSystem requires an environment loader');
    if (typeof postFxFactory !== 'function') throw new TypeError('RenderingSystem postFxFactory must be a function');
    if (typeof generatedVisualLoader !== 'function') throw new TypeError('RenderingSystem generatedVisualLoader must be a function');

    this.container = container;
    this.scene = scene;
    this.events = events;
    this.rendererFactory = rendererFactory;
    this.rendererMode = rendererMode;
    this.rendererTiming = Boolean(rendererTiming);
    this.controlsFactory = controlsFactory;
    this.environmentLoader = environmentLoader;
    this.postFxFactory = postFxFactory;
    this.postFxOptions = postFxOptions;
    this.generatedVisualLoader = generatedVisualLoader;
    this.onDeviceLost = typeof onDeviceLost === 'function' ? onDeviceLost : null;
    this.onError = typeof onError === 'function' ? onError : null;
    this.camera = null;
    this.renderer = null;
    this.controls = null;
    this.info = null;
    this.probe = null;
    this.environmentTexture = null;
    this.environmentVersion = 0;
    this.environmentTask = Promise.resolve(false);
    this.postFx = null;
    this.generatedVisual = null;
    this.generatedVisualState = { status:'none', format:null, splatCount:0 };
    this.visualTask = Promise.resolve(false);
  }

  async init() {
    this.camera = new THREE.PerspectiveCamera(45, 1, 0.05, 120);
    const result = await this.rendererFactory({
      mode: this.rendererMode,
      antialias: true,
      alpha: false,
      trackTimestamp: this.rendererTiming
    });

    this.renderer = result.renderer;
    this.info = result.info;
    this.probe = new RendererProbe(this.renderer, {
      requestedMode: this.rendererMode,
      onDeviceLost: (detail) => {
        this.onDeviceLost?.(detail);
        this.events?.emit?.('renderer.device-lost', detail);
      },
      onError: (detail) => {
        this.onError?.(detail);
        this.events?.emit?.('renderer.error', detail);
      }
    });

    const pixelRatio = typeof devicePixelRatio === 'number' ? devicePixelRatio : 1;
    this.renderer.setPixelRatio(Math.min(pixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.container.appendChild(this.renderer.domElement);

    this.postFx = this.postFxFactory({
      renderer: this.renderer,
      scene: this.scene,
      camera: this.camera,
      options: this.postFxOptions
    });

    this.controls = this.controlsFactory(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.resize();
    return this;
  }

  applyEnvironment(environment = {}) {
    const version = ++this.environmentVersion;
    this.releaseEnvironmentTexture();
    this.releaseGeneratedVisual();

    const rendering = environment.rendering || {};
    const background = rendering.background ?? 0x080b10;
    this.scene.background = new THREE.Color(background);
    const fog = rendering.fog || { color: background, near: 22, far: 58 };
    this.scene.fog = new THREE.Fog(fog.color, fog.near, fog.far);
    this.renderer.toneMappingExposure = rendering.exposure ?? 1.1;

    const camera = environment.camera || {};
    if (Number.isFinite(camera.far)) {
      this.camera.far = camera.far;
      this.camera.updateProjectionMatrix();
    }
    if (Array.isArray(camera.position)) this.camera.position.fromArray(camera.position);
    if (Array.isArray(camera.target)) this.controls.target.fromArray(camera.target);
    this.controls.update();

    const ibl = rendering.ibl;
    this.environmentTask = ibl?.url
      ? this.loadEnvironmentTexture(ibl, version)
      : Promise.resolve(false);
    this.visualTask = environment.generated?.visual
      ? this.loadGeneratedVisual(environment, version)
      : Promise.resolve(false);
    return true;
  }

  async loadGeneratedVisual(environment, version) {
    const visual = environment.generated?.visual;
    if (!visual) return false;
    const format = String(visual.format || visual.source?.format || '').toLowerCase();
    if (format !== 'spz') return false;
    if (this.renderer?.backend?.isWebGPUBackend !== true) {
      visual.status = 'unsupported-backend';
      this.generatedVisualState = { status:'unsupported-backend', format, splatCount:0 };
      return false;
    }

    visual.status = 'loading';
    this.generatedVisualState = { status:'loading', format, splatCount:0 };
    try {
      const loaded = await this.generatedVisualLoader({
        source:visual.source || visual,
        coordinateSystem:environment.generated.coordinateSystem || 'y-up',
        metersPerUnit:environment.generated.metersPerUnit ?? 1
      });
      if (version !== this.environmentVersion || !this.renderer) {
        loaded?.dispose?.();
        return false;
      }
      if (!loaded?.object?.isObject3D) throw new TypeError('Generated visual loader must return an Object3D');
      environment.root?.add?.(loaded.object);
      const fallbackMaterial = environment.floor?.material || null;
      if (fallbackMaterial) fallbackMaterial.visible = false;
      this.generatedVisual = { ...loaded, root:environment.root || null, fallbackMaterial };
      visual.status = 'ready';
      this.generatedVisualState = {
        status:'ready',
        format:loaded.format || format,
        splatCount:loaded.splatCount || 0
      };
      this.events?.emit?.('renderer.generated-visual-ready', {
        format:this.generatedVisualState.format,
        splatCount:this.generatedVisualState.splatCount
      });
      return true;
    } catch (error) {
      if (version === this.environmentVersion && this.renderer) {
        visual.status = 'failed';
        this.generatedVisualState = { status:'failed', format, splatCount:0 };
        this.events?.emit?.('renderer.generated-visual-error', {
          format,
          message:error instanceof Error ? error.message : String(error)
        });
      }
      return false;
    }
  }

  releaseGeneratedVisual() {
    const visual = this.generatedVisual;
    if (visual?.object?.parent) visual.object.parent.remove(visual.object);
    visual?.dispose?.();
    if (visual?.fallbackMaterial) visual.fallbackMaterial.visible = true;
    this.generatedVisual = null;
    this.generatedVisualState = { status:'none', format:null, splatCount:0 };
  }

  async loadEnvironmentTexture(ibl, version) {
    try {
      const texture = await this.environmentLoader.loadAsync(ibl.url);
      if (version !== this.environmentVersion || !this.renderer) {
        texture.dispose?.();
        return false;
      }
      texture.mapping = THREE.EquirectangularReflectionMapping;
      this.environmentTexture = texture;
      this.scene.environment = texture;
      this.scene.environmentIntensity = Number.isFinite(ibl.intensity) ? ibl.intensity : 1;
      if (ibl.background === true) {
        this.scene.background = texture;
        if (Number.isFinite(ibl.backgroundIntensity)) this.scene.backgroundIntensity = ibl.backgroundIntensity;
      }
      return true;
    } catch (error) {
      if (version === this.environmentVersion && this.renderer) {
        this.events?.emit?.('renderer.environment-error', {
          url: ibl.url,
          message: error instanceof Error ? error.message : String(error)
        });
      }
      return false;
    }
  }
  releaseEnvironmentTexture() {
    const texture = this.environmentTexture;
    if (!texture) return;
    if (this.scene.environment === texture) this.scene.environment = null;
    if (this.scene.background === texture) this.scene.background = null;
    texture.dispose?.();
    this.environmentTexture = null;
  }

  viewport() {
    if (!this.camera || !this.renderer || !this.controls) return null;
    return { camera:this.camera, element:this.renderer.domElement, controls:this.controls };
  }

  viewPose() {
    if (!this.camera) return null;
    this.viewPoseState ||= { position:[0,0,0], rotation:[0,0,0,1] };
    this.camera.position.toArray(this.viewPoseState.position);
    this.camera.quaternion.toArray(this.viewPoseState.rotation);
    return this.viewPoseState;
  }

  cameraState() {
    if (!this.camera || !this.controls) return null;
    return { position:this.camera.position.toArray(), target:this.controls.target.toArray() };
  }

  applyCameraState(state = {}) {
    if (!this.camera || !this.controls) return false;
    if (Array.isArray(state.position) && state.position.length === 3) this.camera.position.fromArray(state.position);
    if (Array.isArray(state.target) && state.target.length === 3) this.controls.target.fromArray(state.target);
    this.controls.update();
    return true;
  }

  update() {
    this.controls?.update();
  }

  render(timestamp = performance.now()) {
    if (this.postFx?.enabled) {
      try {
        this.postFx.render();
      } catch (error) {
        this.disablePostFx(error);
        this.renderer.render(this.scene, this.camera);
      }
    } else {
      this.renderer.render(this.scene, this.camera);
    }
    this.probe?.afterRender(timestamp);
  }

  disablePostFx(error) {
    const diagnostics = this.postFx?.diagnostics?.() || null;
    this.postFx?.dispose?.();
    this.postFx = null;
    this.events?.emit?.('renderer.postfx-error', {
      message: error instanceof Error ? error.message : String(error),
      postfx: diagnostics
    });
  }

  resize() {
    const width = this.container.clientWidth;
    const height = this.container.clientHeight;
    if (!width || !height || !this.camera || !this.renderer) return false;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
    return true;
  }

  diagnostics() {
    const base = this.probe?.snapshot?.() || this.info;
    if (!base) return base;
    return {
      ...base,
      postfx:this.postFx?.diagnostics?.() || { enabled:false, effects:[] },
      generatedVisual:{...this.generatedVisualState}
    };
  }

  dispose() {
    this.environmentVersion += 1;
    this.releaseEnvironmentTexture();
    this.releaseGeneratedVisual();
    this.postFx?.dispose?.();
    this.postFx = null;
    this.controls?.dispose?.();
    this.controls = null;
    this.probe?.dispose?.();
    this.probe = null;
    this.renderer?.dispose?.();
    this.renderer?.domElement?.remove?.();
    this.renderer = null;
    this.camera = null;
    this.info = null;
  }
}
