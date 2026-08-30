import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';

export class GltfAssetLoader {
  constructor({
    loader = new GLTFLoader(),
    meshoptDecoder = MeshoptDecoder,
    ktx2TranscoderPath = '/basis/',
    ktx2LoaderFactory = () => new KTX2Loader()
  } = {}) {
    if (!loader || typeof loader.loadAsync !== 'function') {
      throw new TypeError('GltfAssetLoader requires a GLTF-compatible loader');
    }
    if (typeof ktx2LoaderFactory !== 'function') throw new TypeError('GltfAssetLoader ktx2LoaderFactory must be a function');
    this.loader = loader;
    this.ktx2TranscoderPath = ktx2TranscoderPath;
    this.ktx2LoaderFactory = ktx2LoaderFactory;
    this.ktx2Loader = null;
    this.loader.setMeshoptDecoder?.(meshoptDecoder);
  }


  configureRenderer(renderer) {
    if (!renderer) throw new TypeError('GltfAssetLoader.configureRenderer requires a renderer');
    if (typeof this.loader.setKTX2Loader !== 'function' || !this.ktx2TranscoderPath) return false;
    this.ktx2Loader?.dispose?.();
    this.ktx2Loader = this.ktx2LoaderFactory()
      .setTranscoderPath(this.ktx2TranscoderPath)
      .detectSupport(renderer);
    this.loader.setKTX2Loader(this.ktx2Loader);
    return true;
  }

  async load(url) {
    const gltf = await this.loader.loadAsync(url);
    if (!gltf?.scene) throw new Error(`GLTF has no default scene: ${url}`);
    return gltf;
  }

  async loadScene(url) {
    const gltf = await this.load(url);
    gltf.scene.animations = [...(gltf.animations || [])];
    return gltf.scene;
  }

  dispose() {
    this.ktx2Loader?.dispose?.();
    this.ktx2Loader = null;
  }
}
