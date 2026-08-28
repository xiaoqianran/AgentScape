import { describe, expect, it } from 'vitest';
import { AssetManager } from '../src/assets/AssetManager.js';
import { AssetLibrary } from '../src/assets/library/AssetLibrary.js';

function library(assetManager = new AssetManager()) {
  return new AssetLibrary({ assetManager });
}

describe('AssetLibrary', () => {
  it('is a read-only facade over the Asset catalog', () => {
    const assets = library();
    expect(assets.search('chair')[0].id).toBe('chair');
    expect(assets.search('椅子')[0].id).toBe('chair');
    expect(assets.search('mug')[0].id).toBe('cup');
    expect(assets.list().length).toBeGreaterThan(0);
    expect(assets.has('chair')).toBe(true);
    expect(assets.get('chair').id).toBe('chair');
  });

  it('resolves only existing Assets and never exposes generation methods', () => {
    const assets = library();
    expect(assets.resolveExisting('chair')).toMatchObject({ status: 'found', assets: [{ id: 'chair' }] });
    expect(assets.resolveExisting('spaceship toaster')).toEqual({
      status: 'missing',
      query: 'spaceship toaster',
      assets: []
    });
    expect(assets).not.toHaveProperty('generationPort');
    expect(assets).not.toHaveProperty('generate');
    expect(assets).not.toHaveProperty('resolve');
    expect(assets).not.toHaveProperty('canGenerate');
    expect(assets).not.toHaveProperty('attachGeneration');
  });
});
