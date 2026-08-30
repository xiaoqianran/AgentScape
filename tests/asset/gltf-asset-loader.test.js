import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { GltfAssetLoader } from '../../asset/loading/GltfAssetLoader.js';

describe('GltfAssetLoader', () => {
  it('keeps glTF animations on the returned scene', async () => {
    const scene = new THREE.Group();
    const animations = [new THREE.AnimationClip('open', 1, [])];
    const loader = { loadAsync:vi.fn(async () => ({ scene, animations })) };
    const gltf = new GltfAssetLoader({ loader });

    const loaded = await gltf.loadScene('cabinet.glb');

    expect(loader.loadAsync).toHaveBeenCalledWith('cabinet.glb');
    expect(loaded).toBe(scene);
    expect(loaded.animations).toEqual(animations);
  });

  it('wires Meshopt eagerly and KTX2 only after a renderer is available', () => {
    const loader = {
      loadAsync:vi.fn(),
      setMeshoptDecoder:vi.fn(),
      setKTX2Loader:vi.fn()
    };
    const ktx2 = {
      setTranscoderPath:vi.fn(function () { return this; }),
      detectSupport:vi.fn(function () { return this; }),
      dispose:vi.fn()
    };
    const renderer = {};
    const gltf = new GltfAssetLoader({
      loader,
      meshoptDecoder:'meshopt',
      ktx2TranscoderPath:'/basis/',
      ktx2LoaderFactory:() => ktx2
    });

    expect(loader.setMeshoptDecoder).toHaveBeenCalledWith('meshopt');
    expect(loader.setKTX2Loader).not.toHaveBeenCalled();
    expect(gltf.configureRenderer(renderer)).toBe(true);
    expect(ktx2.setTranscoderPath).toHaveBeenCalledWith('/basis/');
    expect(ktx2.detectSupport).toHaveBeenCalledWith(renderer);
    expect(loader.setKTX2Loader).toHaveBeenCalledWith(ktx2);

    gltf.dispose();
    expect(ktx2.dispose).toHaveBeenCalledOnce();
  });

  it('rejects glTF files without a default scene', async () => {
    const loader = { loadAsync:vi.fn(async () => ({ scenes:[] })) };
    const gltf = new GltfAssetLoader({ loader });
    await expect(gltf.loadScene('invalid.glb')).rejects.toThrow(/no default scene/i);
  });
});
