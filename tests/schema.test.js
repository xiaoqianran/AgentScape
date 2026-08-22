import { describe, expect, it } from 'vitest';
import { validateAssetManifest } from '../src/assets/schema.js';

describe('asset manifest validation', () => {
  it('accepts a minimal valid manifest', () => {
    expect(validateAssetManifest({ id: 'box', type: 'prop', actions: [], physics: { body: 'fixed' } }).id).toBe('box');
  });
  it('rejects duplicate actions', () => {
    expect(() => validateAssetManifest({ id: 'cup', type: 'cup', actions: ['pickup', 'pickup'] })).toThrow(/unique/);
  });
  it('rejects invalid joint type', () => {
    expect(() => validateAssetManifest({ id: 'cabinet', type: 'cabinet', actions: [], parts: { door: { node: 'Door', joint: { type: 'magic' } } } })).toThrow(/joint type/);
  });
});
