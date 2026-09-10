import { WebIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';

export function createAssetGLTFIO() {
  return new WebIO().registerExtensions(ALL_EXTENSIONS);
}
