import { describe, expect, it } from 'vitest';
import { assetIdFromRef, createAssetRef } from '../../asset/AssetRef.js';

describe('AssetRef', () => {
  it('keeps the Asset→World contract intentionally deep and small', () => {
    expect(createAssetRef(' red_apple ')).toEqual({ assetId:'red_apple' });
    expect(assetIdFromRef({ assetId:'red_apple' })).toBe('red_apple');
  });

  it('rejects empty identity and treats absent refs as unresolved', () => {
    expect(() => createAssetRef('   ')).toThrow(/requires assetId/);
    expect(assetIdFromRef(null)).toBeNull();
  });
});
