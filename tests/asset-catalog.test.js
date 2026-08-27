import { describe, expect, it } from 'vitest';
import { AssetCatalog, searchAssetManifests, summarizeAsset } from '../src/assets/AssetCatalog.js';
import { AssetManager } from '../src/assets/AssetManager.js';

const manifest = (overrides = {}) => ({
  id: 'fixture',
  type: 'object',
  label: 'Fixture',
  description: '',
  tags: [],
  aliases: [],
  source: { kind: 'builtin' },
  actions: ['move'],
  physics: { body: 'fixed', colliders: [] },
  ...overrides
});

describe('AssetCatalog', () => {
  it('summarizes and searches manifests without provider knowledge', () => {
    const apple = manifest({
      id: 'red_apple',
      type: 'fruit',
      label: 'Red Apple',
      tags: ['apple', 'fruit', '苹果'],
      aliases: ['malus']
    });
    const table = manifest({ id: 'wood_table', type: 'table', label: 'Wood Table', tags: ['furniture'] });
    expect(summarizeAsset(apple)).toMatchObject({ id: 'red_apple', type: 'fruit', source: 'builtin' });
    expect(searchAssetManifests([apple, table], '苹果')[0].id).toBe('red_apple');
    expect(searchAssetManifests([apple, table], 'table')[0].id).toBe('wood_table');
  });

  it('resolves only already-published assets', () => {
    const assets = new AssetManager({ manifests: {} });
    assets.registerManifest(manifest({ id: 'published_apple', label: 'Published Apple', tags: ['apple'] }));
    const catalog = new AssetCatalog({ assetManager: assets });

    expect(catalog.resolveExisting('apple')).toMatchObject({
      status: 'found',
      assets: [{ id: 'published_apple' }]
    });
    expect(catalog.resolveExisting('spaceship toaster')).toEqual({
      status: 'missing',
      query: 'spaceship toaster',
      assets: []
    });
  });

  it('can resolve a stable AssetRef directly', () => {
    const assets = new AssetManager({ manifests: {} });
    assets.registerManifest(manifest({ id: 'asset_ref_fixture' }));
    const catalog = new AssetCatalog({ assetManager: assets });

    expect(catalog.resolveExisting('ignored', { assetId: 'asset_ref_fixture' })).toMatchObject({
      status: 'found',
      assets: [{ id: 'asset_ref_fixture' }]
    });
  });
});
