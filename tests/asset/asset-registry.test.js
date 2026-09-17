import { describe, expect, it } from 'vitest';
import { AssetRegistry } from '../../modules/asset/registry/AssetRegistry.js';

const manifest = (label = 'A') => ({
  id:'same',
  type:'object',
  label,
  source:{ kind:'glb', url:'assets/a.glb' },
  actions:['move']
});

describe('AssetRegistry', () => {
  it('owns manifest identity and idempotent registration', () => {
    const registry = new AssetRegistry({ manifests:{} });
    expect(registry.registerManifest(manifest())).toBe(true);
    expect(registry.registerManifest({ actions:['move'], source:{url:'assets/a.glb',kind:'glb'}, label:'A', type:'object', id:'same' })).toBe(false);
    expect(registry.size).toBe(1);
  });

  it('rejects conflicting identities unless replacement is explicit', () => {
    const registry = new AssetRegistry({ manifests:{} });
    registry.registerManifest(manifest('A'));
    expect(() => registry.registerManifest(manifest('B'))).toThrow(/conflict/i);
    expect(registry.registerManifest(manifest('B'), { replace:true })).toBe(true);
    expect(registry.getManifest('same').label).toBe('B');
  });

  it('returns cloned manifests instead of leaking mutable registry state', () => {
    const registry = new AssetRegistry({ manifests:{ same:manifest() } });
    const value = registry.getManifest('same');
    value.label = 'mutated';
    expect(registry.getManifest('same').label).toBe('A');
    expect(registry.listManifests()).toHaveLength(1);
  });
});
