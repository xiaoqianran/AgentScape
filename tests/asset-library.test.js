import { describe, expect, it, vi } from 'vitest';
import { AssetManager } from '../src/runtime/AssetManager.js';
import { AssetLibrary } from '../src/assets/library/AssetLibrary.js';

function library(generator = null) {
  return new AssetLibrary({ assetManager: new AssetManager(), generator });
}

describe('AssetLibrary', () => {
  it('searches ids, aliases and multilingual tags', () => {
    const assets = library();
    expect(assets.search('chair')[0].id).toBe('chair');
    expect(assets.search('椅子')[0].id).toBe('chair');
    expect(assets.search('mug')[0].id).toBe('cup');
  });

  it('resolves reusable assets before generation', async () => {
    const generator = { isConfigured: () => true, generate: vi.fn() };
    const result = await library(generator).resolve('chair', { generate: true });
    expect(result.status).toBe('found');
    expect(generator.generate).not.toHaveBeenCalled();
  });

  it('reports a missing generator explicitly', async () => {
    const result = await library().resolve('spaceship toaster', { generate: true });
    expect(result.status).toBe('generator_not_configured');
    expect(result.assets).toEqual([]);
  });

  it('registers a generated GLB manifest for immediate reuse', async () => {
    const generator = {
      isConfigured: () => true,
      generate: vi.fn(async () => ({ manifest: { id: 'plant_generated', type: 'plant', label: 'Plant', tags: ['plant'], source: { kind: 'glb', url: 'https://assets.test/plant.glb' }, actions: ['move'], physics: { body: 'fixed', colliders: [] } } }))
    };
    const assets = library(generator);
    const result = await assets.resolve('rare plant', { generate: true });
    expect(result.status).toBe('generated');
    expect(assets.search('plant')[0].id).toBe('plant_generated');
  });
});
