import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { ArtifactRegistry } from '../../src/artifacts/ArtifactRegistry.js';
import { MemoryArtifactByteStore } from '../../src/artifacts/MemoryArtifactByteStore.js';
import { AssetCompiler } from '../../src/compiler/AssetCompiler.js';
import { createAssetModule } from '../../src/assets/createAssetModule.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const candidates = [
  {
    path: path.join(root, 'research/modal-lab/041-modal-3d-provider/results/fastsam3d-plus-plus.glb'),
    sourceKind: 'modal-3d',
    provider: 'modal-3d',
    operation: 'modal-3d.asset.image_to_3d.v1',
    modelId: 'fastsam3d-plus-plus'
  },
  {
    path: path.join(root, 'research/modal-lab/023-b-sf3d/viewer/smoke_l40s.glb'),
    sourceKind: 'modal-lab',
    provider: 'modal-lab',
    operation: 'modal-lab.asset.image_to_3d.v1',
    modelId: 'stable-fast-3d'
  },
  {
    path: path.join(root, 'public/assets/cabinet.glb'),
    sourceKind: 'fixture',
    provider: 'fixture',
    operation: 'fixture.asset.import.v1',
    modelId: 'cabinet-fixture'
  }
];
const explicitPath = process.env.AGENTSCAPE_ASSET_GLB || null;
const selected = explicitPath
  ? { path: explicitPath, sourceKind: 'fixture', provider: 'fixture', operation: 'fixture.asset.import.v1', modelId: 'external-fixture' }
  : candidates.find((candidate) => existsSync(candidate.path));
if (!selected) throw new Error('Asset experiment has no GLB source');
const sourcePath = selected.path;

class MemoryCompilerStore {
  constructor() { this.entries = new Map(); }
  async put(key, bytes, metadata) {
    this.entries.set(key, { bytes: new Uint8Array(bytes), metadata });
    return key;
  }
  async get(key) { return this.entries.get(key) || null; }
}

const bytes = new Uint8Array(await readFile(sourcePath));
const digest = `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
const artifactId = 'experiment_publication_glb';
const assetId = 'experiment_published_asset';
const now = '2026-08-27T00:00:00.000Z';

const registry = new ArtifactRegistry({ now: () => Date.parse(now) });
registry.register({
  id: artifactId,
  role: 'primary-glb',
  type: 'asset-bundle',
  schema: { id: 'agentscape.artifact', version: '1' },
  displayName: 'Experiment Publication GLB',
  mime: 'model/gltf-binary',
  format: 'glb',
  bytes: bytes.byteLength,
  hash: digest,
  producer: {
    jobId: 'experiment_publication_job',
    provider: selected.provider,
    operation: selected.operation,
    stage: 'generation',
    attempt: 1,
    revision: 'experiment-041',
    model: { id: selected.modelId, version: 'experiment', revision: selected.sourceKind },
    workflow: { id: 'image-to-3d', version: '1', revision: 'experiment' }
  },
  lineage: { parents: [{ artifactId: 'experiment_source_image', hash: `sha256:${'b'.repeat(64)}`, relation: 'input' }] },
  createdAt: now,
  retention: { class: 'project' },
  locations: []
});

const byteStore = new MemoryArtifactByteStore();
const writer = byteStore.begin({ artifactId, maxBytes: bytes.byteLength });
await writer.write(bytes);
await writer.commit({ key: 'experiment_publication_cache', hash: digest, mime: 'model/gltf-binary', bytes: bytes.byteLength });
registry.updateLocation(artifactId, {
  id: 'experiment_publication_location',
  kind: 'local-cache',
  scope: 'application',
  state: 'available',
  verifiedAt: now,
  access: { kind: 'cache-key', key: 'experiment_publication_cache' }
});
registry.verifyIntegrity(artifactId, {
  hash: digest,
  bytes: bytes.byteLength,
  mime: 'model/gltf-binary',
  verifiedAt: now,
  method: 'experiment-sha256-v1'
});

const compilerStore = new MemoryCompilerStore();
const assetModule = createAssetModule({
  manifests: {},
  compiledStore: compilerStore,
  artifactRegistry: registry,
  byteStore,
  now: () => Date.parse(now)
});
const compiler = new AssetCompiler({ store: compilerStore, version: 'asset-experiment-001' });
assetModule.configurePublication({
  getAssetCompiler: async () => compiler,
  idFactory: () => 'experiment_asset_lease'
});
const result = await assetModule.publishAsset({ artifactId, assetId, label: 'Experiment Published Asset' });
if (result.status === 'asset-rejected') throw new Error(`Asset experiment rejected: ${JSON.stringify(result.admission)}`);

const catalog = assetModule.catalog;
const found = catalog.search('Published Asset', { limit: 3 });
if (!found.some((asset) => asset.id === assetId)) throw new Error('Published Asset is not searchable through AssetCatalog');
if (result.artifactId === result.assetId) throw new Error('Artifact and Asset identities must remain distinct');
if (!(await compilerStore.get(assetId))) throw new Error('Compiled Asset bytes were not stored');

console.log(JSON.stringify({
  status: 'passed',
  experiment: 'asset/001-real-glb-admission',
  source: path.relative(root, sourcePath),
  sourceKind: selected.sourceKind,
  realGeneratedArtifact: selected.sourceKind === 'modal-3d' || selected.sourceKind === 'modal-lab',
  artifact: { id: artifactId, bytes: bytes.byteLength, digest },
  asset: {
    id: assetId,
    status: result.status,
    admission: result.admission.status,
    reasons: result.admission.reasons,
    searchable: true,
    assetRef: result.assetRef
  }
}, null, 2));
