import { describe, expect, it } from 'vitest';
import { validateAssetManifest } from '../src/assets/schema.js';

describe('asset manifest validation', () => {
  it('accepts a minimal valid manifest', () => {
    expect(validateAssetManifest({ id: 'box', type: 'prop', source: { kind: 'builtin' }, actions: [], physics: { body: 'fixed' } }).id).toBe('box');
  });
  it('rejects duplicate actions', () => {
    expect(() => validateAssetManifest({ id: 'cup', type: 'cup', source: { kind: 'builtin' }, actions: ['pickup', 'pickup'] })).toThrow(/unique/);
  });
  it('rejects invalid joint type', () => {
    expect(() => validateAssetManifest({ id: 'cabinet', type: 'cabinet', source: { kind: 'builtin' }, actions: [], parts: { door: { node: 'Door', joint: { type: 'magic' } } } })).toThrow(/joint type/);
  });
});
