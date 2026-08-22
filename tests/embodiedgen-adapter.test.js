import { describe, expect, it } from 'vitest';
import { EmbodiedGenAdapter } from '../src/adapters/EmbodiedGenAdapter.js';
import { validateAssetManifest } from '../src/assets/schema.js';

describe('EmbodiedGenAdapter', () => {
  it('normalizes an external simulation asset into AgentScape manifest', () => {
    const manifest = new EmbodiedGenAdapter().toManifest({
      id: 'mug-42', category: 'cup', dimensions: [0.1, 0.12, 0.1], mass_kg: 0.3,
      friction: 0.4, affordances: ['pickup', 'place'], glb_url: 'https://assets.test/mug.glb'
    });
    expect(manifest.actions).toEqual(expect.arrayContaining(['move', 'pickup', 'place']));
    expect(manifest.physics.mass).toBe(0.3);
    expect(manifest.provenance.provider).toBe('embodiedgen');
    expect(() => validateAssetManifest(manifest)).not.toThrow();
  });

  it('requires a browser-reachable GLB', () => {
    expect(() => new EmbodiedGenAdapter().toManifest({ id: 'x' })).toThrow(/GLB URL/);
  });
});
