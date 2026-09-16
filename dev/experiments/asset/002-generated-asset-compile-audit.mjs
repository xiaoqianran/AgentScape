// Experiment 2: audit what a REAL generated asset becomes after the current compile chain.
//
// Answers, per sample, the seven questions from the round brief:
//   input provenance / parts / joints / receptacle / admission / special-case code / failure mode
//
// Sample A: real generated chairs (image-to-3d provider output already in the repo).
// Sample B: no generated openable cabinet or chest exists in the repository; the only articulated
//           asset is the hand-authored 1992-byte public/assets/cabinet.glb fixture, which is used
//           here as a control, NOT as evidence that generated articulation works.
//
// Read-only. No product code is modified.
// Run with:
//   node dev/experiments/asset/002-generated-asset-compile-audit.mjs
import { createHash } from 'node:crypto';
import { access, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { ArtifactRegistry } from '../../../modules/artifact/ArtifactRegistry.js';
import { MemoryArtifactByteStore } from '../../../modules/artifact/MemoryArtifactByteStore.js';
import { AssetCompiler } from '../../../modules/asset/compiler/AssetCompiler.js';
import { createAssetModule } from '../../../modules/asset/AssetModule.js';

const SIM_NOW = '2026-09-17T00:00:00.000Z';

class MemoryCompilerStore {
  constructor() { this.entries = new Map(); }
  async put(key, bytes, metadata) { this.entries.set(key, { bytes: new Uint8Array(bytes), metadata }); return key; }
  async get(key) { return this.entries.get(key) || null; }
}

const SAMPLES = [
  { id: 'gen-chair-fastsam3d', group: 'A-generated', path: 'public/generated-e2e/2026-09-07/assets/fastsam3d-chair.glb', provider: 'fastsam3d-plus-plus', intent: 'chair' },
  { id: 'gen-chair-hunyuan21', group: 'A-generated', path: 'public/generated-e2e/2026-09-07/assets/hunyuan21-chair.glb', provider: 'hunyuan2.1-plus-plus', intent: 'chair' },
  { id: 'gen-chair-pixal3d', group: 'A-generated', path: 'public/generated-e2e/2026-09-07/assets/pixal3d-chair.glb', provider: 'pixal3d', intent: 'chair' },
  { id: 'gen-chair-trellis2', group: 'A-generated', path: 'public/generated-e2e/2026-09-07/assets/trellis2-chair.glb', provider: 'hermit-trellis2-plus-plus', intent: 'chair' },
  { id: 'gen-bench-fastsam3d', group: 'A2-provider-benchmark', path: '.live-generated/provider-benchmark-20260908/fastsam3d-plus-plus.glb', provider: 'fastsam3d-plus-plus', intent: 'unspecified object' },
  { id: 'gen-bench-hunyuan21', group: 'A2-provider-benchmark', path: '.live-generated/provider-benchmark-20260908-parallel/hunyuan2.1-plus-plus.glb', provider: 'hunyuan2.1-plus-plus', intent: 'unspecified object' },
  { id: 'gen-bench-pixal3d', group: 'A2-provider-benchmark', path: '.live-generated/provider-benchmark-20260908-parallel/pixal3d.glb', provider: 'pixal3d', intent: 'unspecified object' },
  { id: 'gen-bench-hermit-trellis2', group: 'A2-provider-benchmark', path: '.live-generated/provider-benchmark-20260908-parallel/hermit-trellis2-plus-plus.glb', provider: 'hermit-trellis2-plus-plus', intent: 'unspecified object' },
  { id: 'gen-embodiedgen-sample00', group: 'A3-other-generated', path: 'tests/fixtures/embodiedgen-affordance-v1/sample_00.glb', provider: 'embodiedgen', intent: 'articulated fixture sample' },
  { id: 'control-cabinet-fixture', group: 'C-control', path: 'public/assets/cabinet.glb', provider: 'hand-authored fixture', intent: 'cabinet with door (NOT generated)' }
];

const clip = (value, max = 2400) => {
  const text = JSON.stringify(value);
  if (text === undefined) return null;
  return text.length > max ? text.slice(0, max) + '...<clipped>' : text;
};

async function compileSample(sample) {
  const bytes = new Uint8Array(await readFile(sample.path));
  const store = new MemoryCompilerStore();
  const compiler = new AssetCompiler({ store, version: 'asset-audit-002' });
  const result = await compiler.compile({ bytes, sourceName: path.basename(sample.path), assetId: sample.id, label: sample.id });
  return { bytes, result };
}

async function publishSample(sample, bytes, manifestRequiredNodes) {
  const digest = 'sha256:' + createHash('sha256').update(bytes).digest('hex');
  const artifactId = sample.id + '_artifact';
  const assetId = sample.id + '_asset';
  // ArtifactDescriptor requires operation to start with '<provider>.' and end with '.v<digits>'.
  const provider = sample.group === 'C-control' ? 'fixture' : sample.provider;
  const operation = sample.group === 'C-control' ? 'fixture.asset.import.v1' : provider + '.asset.image_to_3d.v1';
  const registry = new ArtifactRegistry({ now: () => Date.parse(SIM_NOW) });
  registry.register({
    id: artifactId, role: 'primary-glb', type: 'asset-bundle',
    schema: { id: 'agentscape.artifact', version: '1' },
    displayName: sample.id, mime: 'model/gltf-binary', format: 'glb',
    bytes: bytes.byteLength, hash: digest,
    producer: {
      jobId: sample.id + '_job', provider,
      operation, stage: 'generation', attempt: 1,
      revision: 'audit-002', model: { id: provider, version: 'audit', revision: sample.group },
      workflow: { id: 'image-to-3d', version: '1', revision: 'audit' }
    },
    lineage: { parents: [{ artifactId: sample.id + '_source_image', hash: 'sha256:' + 'b'.repeat(64), relation: 'input' }] },
    createdAt: SIM_NOW, retention: { class: 'project' }, locations: []
  });
  const byteStore = new MemoryArtifactByteStore();
  const writer = byteStore.begin({ artifactId, maxBytes: bytes.byteLength });
  await writer.write(bytes);
  await writer.commit({ key: sample.id + '_cache', hash: digest, mime: 'model/gltf-binary', bytes: bytes.byteLength });
  registry.updateLocation(artifactId, {
    id: sample.id + '_location', kind: 'local-cache', scope: 'application', state: 'available',
    verifiedAt: SIM_NOW, access: { kind: 'cache-key', key: sample.id + '_cache' }
  });
  registry.verifyIntegrity(artifactId, { hash: digest, bytes: bytes.byteLength, mime: 'model/gltf-binary', verifiedAt: SIM_NOW, method: 'audit-sha256-v1' });

  const compilerStore = new MemoryCompilerStore();
  const assetModule = createAssetModule({ manifests: {}, compiledStore: compilerStore, artifactRegistry: registry, byteStore, now: () => Date.parse(SIM_NOW) });
  const compiler = new AssetCompiler({ store: compilerStore, version: 'asset-audit-002' });
  assetModule.configurePublication({ artifacts: { registry, byteStore }, getAssetCompiler: async () => compiler, idFactory: () => sample.id + '_lease' });
  const published = await assetModule.publishAsset({ artifactId, assetId, label: sample.id });
  return {
    status: published.status,
    admission: published.admission ? { status: published.admission.status, reasons: published.admission.reasons || [] } : null,
    searchable: assetModule.catalog.search(sample.id, { limit: 5 }).some((entry) => entry.id === assetId),
    requiredNodes: manifestRequiredNodes || null
  };
}

const rows = [];
for (const sample of SAMPLES) {
  const row = { id: sample.id, group: sample.group, provider: sample.provider, intent: sample.intent, path: sample.path };
  try { await access(sample.path); } catch { row.missing = true; rows.push(row); console.log('--- ' + sample.id + ' --- MISSING'); continue; }
  try {
    const { bytes, result } = await compileSample(sample);
    row.bytes = bytes.byteLength;
    row.quality = { status: result.quality && result.quality.status, reasons: (result.quality && result.quality.reasons) || [] };
    row.manifest = {
      requiredNodes: result.manifest && result.manifest.requiredNodes ? result.manifest.requiredNodes : null,
      parts: result.manifest && result.manifest.parts ? Object.keys(result.manifest.parts) : null,
      receptacles: result.manifest && result.manifest.receptacles ? result.manifest.receptacles.map((r) => r.id || r) : null,
      surfaces: result.manifest && result.manifest.surfaces ? result.manifest.surfaces.map((s) => s.id || s) : null,
      colliderShapes: result.manifest && result.manifest.physics && result.manifest.physics.colliders ? result.manifest.physics.colliders.map((c) => c.shape) : null,
      physicsBody: result.manifest && result.manifest.physics ? result.manifest.physics.body : null,
      actions: result.manifest ? result.manifest.actions : null,
      sourceKind: result.manifest && result.manifest.source ? result.manifest.source.kind : null
    };
    row.inspection = clip(result.inspection, 1800);
    row.structure = clip(result.structure, 1800);
    row.geometry = clip(result.geometry, 1200);
    row.articulation = clip(result.articulation, 1800);
    row.collision = clip(result.collision, 900);
    row.partProposal = clip(result.partProposal, 1200);
    row.partSegmentation = clip(result.partSegmentation, 1200);
    row.partGeometry = clip(result.partGeometry, 1200);
    row.partCollision = clip(result.partCollision, 900);
    row.enrichment = clip(result.enrichment, 900);
    row.resources = clip(result.resources, 900);
    try {
      row.publication = await publishSample(sample, bytes, row.manifest.requiredNodes);
    } catch (error) {
      row.publication = { error: String(error && error.message ? error.message : error).slice(0, 200) };
    }
  } catch (error) {
    row.error = String(error && error.message ? error.message : error).slice(0, 260);
    if (error && error.details) row.errorDetails = clip(error.details, 900);
  }
  rows.push(row);
  console.log('--- ' + sample.id + ' ---');
  console.log(JSON.stringify(row));
}

const summary = rows.map((r) => ({
  id: r.id, group: r.group, bytes: r.bytes,
  quality: r.quality && r.quality.status,
  qualityReasons: r.quality && r.quality.reasons && r.quality.reasons.join(','),
  parts: r.manifest && r.manifest.parts && r.manifest.parts.length,
  requiredNodes: r.manifest && r.manifest.requiredNodes && r.manifest.requiredNodes.length,
  receptacles: r.manifest && r.manifest.receptacles && r.manifest.receptacles.length,
  surfaces: r.manifest && r.manifest.surfaces && r.manifest.surfaces.length,
  body: r.manifest && r.manifest.physicsBody,
  actions: r.manifest && r.manifest.actions && r.manifest.actions.join('|'),
  admission: r.publication && r.publication.admission && r.publication.admission.status,
  admissionReasons: r.publication && r.publication.admission && r.publication.admission.reasons && r.publication.admission.reasons.join(','),
  error: r.error || (r.publication && r.publication.error) || (r.missing ? 'missing-input' : '')
}));
console.log('=== SUMMARY ===');
console.table(summary);

const report = {
  schema: 'agentscape.generated-asset-audit', schemaVersion: 1,
  experiment: 'dev/experiments/asset/002-generated-asset-compile-audit',
  mode: 'offline-deterministic',
  sampleB: {
    required: 'real generated cabinet or chest with open/close intent',
    found: false,
    note: 'No such artifact exists in the repository. The only articulated asset is public/assets/cabinet.glb, a 1992-byte hand-authored fixture used here as a control only.'
  },
  rows, summary,
  generatedAt: new Date().toISOString()
};
await writeFile(new URL('./002-results.json', import.meta.url), JSON.stringify(report, null, 2));
console.log('wrote 002-results.json');
process.exit(0);
