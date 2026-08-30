import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { HDRLoader } from 'three/examples/jsm/loaders/HDRLoader.js';
import { createRenderer } from '../../../core/rendering/createRenderer.js';
import { RendererProbe } from '../../../core/rendering/RendererProbe.js';

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
    onDeviceLost = null,
    onError = null
  } = {}) {
    if (!container) throw new TypeError('RenderingSystem requires a container');
    if (!scene) throw new TypeError('RenderingSystem requires a scene');
    if (typeof rendererFactory !== 'function') throw new TypeError('RenderingSystem rendererFactory must be a function');
    if (typeof controlsFactory !== 'function') throw new TypeError('RenderingSystem controlsFactory must be a function');
    if (!environmentLoader || typeof environmentLoader.loadAsync !== 'function') throw new TypeError('RenderingSystem requires an environment loader');

    this.container = container;
    this.scene = scene;
    this.events = events;
    this.rendererFactory = rendererFactory;
    this.rendererMode = rendererMode;
    this.rendererTiming = Boolean(rendererTiming);
    this.controlsFactory = controlsFactory;
    this.environmentLoader = environmentLoader;
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

    this.controls = this.controlsFactory(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.resize();
    return this;
  }

  applyEnvironment(environment = {}) {
    const version = ++this.environmentVersion;
    this.releaseEnvironmentTexture();

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
    return true;
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

  update() {
    this.controls?.update();
  }

  render(timestamp = performance.now()) {
    this.renderer.render(this.scene, this.camera);
    this.probe?.afterRender(timestamp);
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
    return this.probe?.snapshot?.() || this.info;
  }

  dispose() {
    this.environmentVersion += 1;
    this.releaseEnvironmentTexture();
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
