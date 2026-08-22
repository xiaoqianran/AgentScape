import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { AssetCompiler } from '../src/compiler/AssetCompiler.js';
import { validateAssetManifest } from '../src/assets/schema.js';

class MemoryStore {
  constructor(){ this.map = new Map(); }
  async put(key, bytes, metadata){ this.map.set(key, { bytes, metadata }); return key; }
  async get(key){ return this.map.get(key) || null; }
}

describe('AssetCompiler', () => {
  it('compiles a real GLB through inspect/geometry/semantics/collider/optimize/manifest passes', async () => {
    const bytes = new Uint8Array(await readFile('public/assets/cabinet.glb'));
    const store = new MemoryStore();
    const compiler = new AssetCompiler({ store, version:'test' });
    const result = await compiler.compile({ bytes, sourceName:'cabinet.glb', assetId:'compiled_cabinet' });
    expect(result.manifest.id).toBe('compiled_cabinet');
    expect(result.manifest.type).toBe('cabinet');
    expect(result.manifest.actions).toEqual(['move']);
    expect(result.quality.status).toBe('provisional');
    expect(result.manifest.source.kind).toBe('compiled');
    expect(result.inspection.stats.meshes).toBeGreaterThan(0);
    expect(result.geometry.bounds.size.every((v) => v > 0)).toBe(true);
    expect(result.articulation.candidates.some((c) => c.jointType === 'revolute')).toBe(true);
    expect(result.collision.strategy).toBe('aabb-fallback');
    expect(result.optimization.afterBytes).toBeGreaterThan(0);
    expect(await store.get('compiled_cabinet')).not.toBeNull();
    expect(() => validateAssetManifest(result.manifest)).not.toThrow();
  });
});
