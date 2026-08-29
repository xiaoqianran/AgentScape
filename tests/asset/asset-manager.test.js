import { describe, expect, it } from 'vitest';
import { AssetManager } from '../../asset/AssetManager.js';

const manifest = (label = 'A') => ({
  id: 'same', type: 'object', label,
  source: { kind:'glb', url:'assets/a.glb' }, actions:['move']
});

describe('AssetManager manifest identity', () => {
  it('treats identical re-registration as idempotent', () => {
    const assets = new AssetManager({ manifests:{} });
    expect(assets.registerManifest(manifest())).toBe(true);
    expect(assets.registerManifest({ actions:['move'], source:{url:'assets/a.glb',kind:'glb'}, label:'A', type:'object', id:'same' })).toBe(false);
  });

  it('rejects conflicting manifests with the same id', () => {
    const assets = new AssetManager({ manifests:{} });
    assets.registerManifest(manifest('A'));
    expect(() => assets.registerManifest(manifest('B'))).toThrow(/conflict/);
  });

  it('asserts scene/import compatibility without silently replacing content', () => {
    const assets = new AssetManager({ manifests:{} });
    assets.registerManifest(manifest('A'));
    expect(assets.assertCompatibleManifest(manifest('A'))).toBe(false);
    expect(() => assets.assertCompatibleManifest(manifest('B'))).toThrow(/conflict/);
  });

  it('allows explicit replacement only when requested', () => {
    const assets = new AssetManager({ manifests:{} });
    assets.registerManifest(manifest('A'));
    expect(assets.registerManifest(manifest('B'), { replace:true })).toBe(true);
    expect(assets.getManifest('same').label).toBe('B');
  });
});
