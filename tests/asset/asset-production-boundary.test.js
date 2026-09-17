import { describe, expect, it } from 'vitest';
import {
  AssetProductionPipeline,
  createAssetProducer
} from '../../modules/asset/production/AssetProductionPipeline.js';

describe('Asset production boundary', () => {
  it('requires a compiler factory at the producer factory boundary', () => {
    expect(() => createAssetProducer({})).toThrowError(/getAssetCompiler/);
  });

  it('exposes one production pipeline without layered publication wrappers', () => {
    const pipeline = new AssetProductionPipeline({
      artifactRegistry: {
        get() {},
        acquireLease() {},
        releaseLease() {}
      },
      byteStore: { get() {} },
      assetCompiler: { compile() {} },
      assetRegistry: { registerManifest() {}, getManifest() {}, has() { return false; } }
    });

    expect(typeof pipeline.produce).toBe('function');
  });
});
