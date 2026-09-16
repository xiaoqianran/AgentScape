import { describe, expect, it } from 'vitest';
import {
  AssetPublisher,
  createAssetPublisher
} from '../../modules/asset/publication/AssetPublisher.js';

describe('AssetPublisher publication API', () => {
  it('requires a compiler factory at the public factory boundary', () => {
    expect(() => createAssetPublisher({})).toThrowError(/getAssetCompiler/);
  });

  it('exposes publish() instead of pipeline-oriented produce()', () => {
    const publisher = new AssetPublisher({
      artifactRegistry: {
        get() {},
        acquireLease() {},
        releaseLease() {}
      },
      byteStore: { get() {} },
      assetCompiler: { compile() {} },
      assetRegistry: { registerManifest() {}, getManifest() {}, has() { return false; } }
    });

    expect(typeof publisher.publish).toBe('function');
    expect(publisher.produce).toBeUndefined();
  });
});
