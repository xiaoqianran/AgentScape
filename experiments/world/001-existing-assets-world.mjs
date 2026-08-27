import { AssetCatalog } from '../../src/assets/AssetCatalog.js';
import { AssetManager } from '../../src/runtime/AssetManager.js';
import { createCanonicalWorldPipeline } from '../../src/pipeline/createWorldPipeline.js';

const manifest = (id, type, halfExtents) => ({
  id,
  type,
  label: id,
  source: { kind: 'builtin' },
  actions: ['move'],
  physics: {
    body: 'fixed',
    colliders: [{ shape: 'box', halfExtents, translation: [0, halfExtents[1], 0] }]
  },
  compiler: { quality: { status: 'ready' } }
});

const assets = new AssetManager({ manifests: {} });
assets.registerManifest(manifest('experiment_table', 'table', [1.2, .5, .7]));
assets.registerManifest(manifest('experiment_cup', 'cup', [.16, .16, .16]));
const assetCatalog = new AssetCatalog({ assetManager: assets });
const objects = new Map();
const relations = [];

const runtime = {
  events: null,
  trace: null,
  assets,
  assetCatalog,
  environment: { layout: { bounds: { min: [-5, -5], max: [5, 5] }, groundY: 0, margin: .5 } },
  physics: {
    backend: { capabilities: new Set() },
    manifestPoseClear: () => ({ checked: true, clear: true, blockedBy: [] })
  },
  async spawn(assetId, { id, position }) {
    objects.set(id, { id, assetId, manifest: assets.getManifest(assetId), position: [...position] });
    return id;
  },
  interactions: {
    place(subject, object, options = {}) {
      relations.push({ subject, predicate: 'ON', object, surfaceId: options.surfaceId || null });
      return { status: 'placed' };
    },
    move() { throw new Error('World experiment does not need NEAR/move'); }
  },
  sceneGraph: {
    changed() {},
    update() {},
    list() { return [...relations]; }
  },
  validator: {
    run() {
      return {
        ok: true,
        counts: { hard: 0, advisory: 0 },
        hard: [],
        advisory: [],
        findings: [],
        coverage: { objects: objects.size, relations: relations.length }
      };
    }
  },
  repair: { async repair() { return { status: 'not-needed' }; } },
  serialize({ name }) {
    return { schema: 'agentscape.scene', name, objects: [...objects.keys()], relations: [...relations] };
  },
  store: { get(id) { return objects.get(id) || null; } },
  loadRuleGraph() {}
};

const worldIR = {
  schema: 'agentscape.world-ir',
  schemaVersion: 1,
  revision: { id: 'experiment-world-001' },
  provenance: { source: 'world-experiment', evidenceRefs: [] },
  intent: { name: 'Existing Asset World' },
  policy: { generation: { generate: false }, physics: {} },
  entities: [
    { id: 'table_01', asset: { assetId: 'experiment_table' } },
    { id: 'cup_01', asset: { assetId: 'experiment_cup' } }
  ],
  spatial: { relations: [{ subject: 'cup_01', predicate: 'ON', object: 'table_01', surfaceId: 'top' }], constraints: [] },
  interactions: [],
  rules: [],
  acceptance: []
};

const result = await createCanonicalWorldPipeline(runtime).run(worldIR);
if (result.state.reports.worldAdmission.status !== 'ready') {
  throw new Error(`World experiment did not reach ready: ${JSON.stringify(result.state.reports.worldAdmission)}`);
}
if (objects.size !== 2) throw new Error(`Expected 2 World instances, got ${objects.size}`);
if (!relations.some((edge) => edge.subject === 'cup_01' && edge.predicate === 'ON' && edge.object === 'table_01')) {
  throw new Error('World relation cup_01 ON table_01 was not applied');
}

console.log(JSON.stringify({
  status: 'passed',
  experiment: 'world/001-existing-assets-world',
  generationProviderUsed: false,
  assetIds: [...new Set([...objects.values()].map((entry) => entry.assetId))],
  instances: [...objects.keys()],
  relations,
  worldAdmission: result.state.reports.worldAdmission.status
}, null, 2));
