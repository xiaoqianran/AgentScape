import { describe, expect, it, vi } from 'vitest';
import { AssetCatalog } from '../../asset/AssetCatalog.js';
import { AssetManager } from '../../asset/AssetManager.js';
import { createCanonicalWorldPipeline } from '../../world/compiler/createWorldPipeline.js';

const readyManifest = (id, type = 'object') => ({
  id,
  type,
  source: { kind: 'builtin' },
  actions: ['move'],
  physics: { body: 'fixed', colliders: [{ shape: 'box', halfExtents: [.5, .5, .5], translation: [0, .5, 0] }] },
  compiler: { quality: { status: 'ready' } }
});

const runtime = () => {
  const assets = new AssetManager({ manifests: {} });
  assets.registerManifest(readyManifest('table_fixture', 'table'));
  const assetCatalog = new AssetCatalog({ assetManager: assets });
  const authoring = { resolveAssetRequest: vi.fn(() => { throw new Error('canonical World must not call legacy authoring'); }) };
  const spawned = [];
  return {
    events: null,
    trace: null,
    assets,
    assetCatalog,
    authoring,
    environment: { layout: { bounds: { min: [-4, -4], max: [4, 4] }, groundY: 0, margin: .5 } },
    physics: {
      backend: { capabilities: new Set() },
      manifestPoseClear: () => ({ checked: true, clear: true, blockedBy: [] })
    },
    spawn: vi.fn(async (assetId, { id, position }) => { spawned.push({ assetId, id, position }); return id; }),
    interactions: { place: vi.fn(), move: vi.fn() },
    sceneGraph: { changed: vi.fn(), update: vi.fn() },
    validator: { run: vi.fn(() => ({ ok: true, counts: { hard: 0, advisory: 0 }, hard: [], advisory: [], findings: [], coverage: { objects: spawned.length, relations: 0 } })) },
    repair: { repair: vi.fn() },
    serialize: vi.fn(() => ({ schema: 'agentscape.scene', objects: spawned.map((item) => item.id) })),
    store: { get: vi.fn() },
    loadRuleGraph: vi.fn()
  };
};

const worldIR = (asset) => ({
  schema: 'agentscape.world-ir',
  schemaVersion: 1,
  revision: { id: 'rev-canonical-boundary' },
  provenance: { source: 'experiment' },
  intent: { name: 'Canonical Boundary' },
  entities: [{ id: 'entity_01', asset }],
  spatial: { relations: [], constraints: [] },
  interactions: [],
  rules: [],
  acceptance: []
});

describe('Canonical World asset boundary', () => {
  it('consumes an existing AssetRef without touching legacy generation', async () => {
    const r = runtime();
    const result = await createCanonicalWorldPipeline(r).run(worldIR({ assetId: 'table_fixture' }));

    expect(r.authoring.resolveAssetRequest).not.toHaveBeenCalled();
    expect(r.spawn).toHaveBeenCalledWith('table_fixture', expect.objectContaining({ id: 'entity_01' }));
    expect(result.state.reports.assetAdmission.status).toBe('ready');
  });

  it('refuses generation intent instead of invoking a provider from World', async () => {
    const r = runtime();
    const result = await createCanonicalWorldPipeline(r).run(worldIR({
      query: 'missing red apple',
      generate: true,
      provider: 'modal-3d'
    }));

    expect(r.authoring.resolveAssetRequest).not.toHaveBeenCalled();
    expect(r.spawn).not.toHaveBeenCalled();
    expect(result.state.artifacts.assets[0]).toMatchObject({
      status: 'generation_outside_world'
    });
    expect(result.state.artifacts.assets[0]).not.toHaveProperty('resolution');
    expect(result.state.artifacts.assets[0]).not.toHaveProperty('query');
    expect(result.state.artifacts.assetResolutions[0]).toMatchObject({
      id: 'entity_01',
      query: 'missing red apple',
      status: 'generation_outside_world'
    });
    expect(result.state.reports.assetAdmission.status).toBe('rejected');
  });
});
