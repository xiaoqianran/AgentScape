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
import { VerifiedArtifactAssetPipeline } from '../../src/pipeline/VerifiedArtifactAssetPipeline.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const realProviderGlb = path.join(root, 'research/modal-lab/041-modal-3d-provider/results/fastsam3d-plus-plus.glb');
const fallbackGlb = path.join(root, 'public/assets/cabinet.glb');
const sourcePath = process.env.AGENTSCAPE_ASSET_GLB || (existsSync(realProviderGlb) ? realProviderGlb : fallbackGlb);

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
const artifactId = 'experiment_fastsam3d_apple_glb';
const assetId = 'experiment_red_apple';
const now = '2026-08-27T00:00:00.000Z';

const registry = new ArtifactRegistry({ now: () => Date.parse(now) });
registry.register({
  id: artifactId,
  role: 'primary-glb',
  type: 'asset-bundle',
  schema: { id: 'agentscape.artifact', version: '1' },
  displayName: 'Experiment Red Apple GLB',
  mime: 'model/gltf-binary',
  format: 'glb',
  bytes: bytes.byteLength,
  hash: digest,
  producer: {
    jobId: 'experiment_modal3d_job',
    provider: existsSync(realProviderGlb) && sourcePath === realProviderGlb ? 'modal-3d' : 'fixture',
    operation: 'modal-3d.asset.image_to_3d.v1',
    stage: 'generation',
    attempt: 1,
    revision: 'experiment-041',
    model: { id: 'fastsam3d-plus-plus', version: 'experiment', revision: '041' },
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
await writer.commit({ key: 'experiment_fastsam3d_cache', hash: digest, mime: 'model/gltf-binary', bytes: bytes.byteLength });
registry.updateLocation(artifactId, {
  id: 'experiment_fastsam3d_location',
  kind: 'local-cache',
  scope: 'application',
  state: 'available',
  verifiedAt: now,
  access: { kind: 'cache-key', key: 'experiment_fastsam3d_cache' }
});
registry.verifyIntegrity(artifactId, {
  hash: digest,
  bytes: bytes.byteLength,
  mime: 'model/gltf-binary',
  verifiedAt: now,
  method: 'experiment-sha256-v1'
});

const compilerStore = new MemoryCompilerStore();
const assetModule = createAssetModule({ manifests: {}, compiledStore: compilerStore });
const assets = assetModule.manager;
const compiler = new AssetCompiler({ store: compilerStore, version: 'asset-experiment-001' });
const pipeline = new VerifiedArtifactAssetPipeline({
  artifactRegistry: registry,
  byteStore,
  assetCompiler: compiler,
  assetManager: assets,
  now: () => Date.parse(now),
  idFactory: () => 'experiment_asset_lease'
});
const result = await pipeline.produce({ artifactId, assetId, label: 'Experiment Red Apple' });
if (result.status === 'asset-rejected') throw new Error(`Asset experiment rejected: ${JSON.stringify(result.admission)}`);

const catalog = assetModule.catalog;
const found = catalog.search('apple', { limit: 3 });
if (!found.some((asset) => asset.id === assetId)) throw new Error('Published Asset is not searchable through AssetCatalog');
if (result.artifactId === result.assetId) throw new Error('Artifact and Asset identities must remain distinct');
if (!(await compilerStore.get(assetId))) throw new Error('Compiled Asset bytes were not stored');

console.log(JSON.stringify({
  status: 'passed',
  experiment: 'asset/001-real-glb-admission',
  source: path.relative(root, sourcePath),
  realProviderArtifact: sourcePath === realProviderGlb,
  artifact: { id: artifactId, bytes: bytes.byteLength, digest },
  asset: {
    id: assetId,
    status: result.status,
    admission: result.admission.status,
    reasons: result.admission.reasons,
    searchable: true
  }
}, null, 2));
