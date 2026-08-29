import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { createAssetModule } from '../generation/orchestration/createAssetModule.js';

const NOW = Date.parse('2026-08-28T00:00:00.000Z');
const sha = (bytes) => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;

const readyManifest = (id, label = 'Published Asset') => ({
  id,
  type: 'object',
  label,
  source: { kind: 'compiled', key: id },
  actions: ['move'],
  physics: {
    body: 'fixed',
    mass: 1,
    friction: 0.5,
    colliders: [{ shape: 'box', halfExtents: [0.5, 0.5, 0.5] }]
  },
  compiler: { quality: { status: 'ready' } },
  provenance: { compiler: 'publication-test' }
});

async function registerVerifiedGlb(module, {
  id = 'artifact_publish_01',
  bytes = new Uint8Array([1, 2, 3, 4]),
  cacheKey = `${id}_cache`
} = {}) {
  const hash = sha(bytes);
  const createdAt = new Date(NOW).toISOString();
  module.artifactRegistry.register({
    id,
    role: 'primary-glb',
    type: 'asset-bundle',
    schema: { id: 'agentscape.artifact', version: '1' },
    displayName: id,
    mime: 'model/gltf-binary',
    format: 'glb',
    bytes: bytes.byteLength,
    hash,
    producer: {
      jobId: `${id}_job`,
      provider: 'test-provider',
      operation: 'test-provider.asset.image_to_3d.v1',
      stage: 'generation',
      attempt: 1,
      revision: 'provider-r1',
      model: { id: 'test-model', version: '1', revision: 'model-r1' },
      workflow: { id: 'image-to-3d', version: '1', revision: 'workflow-r1' }
    },
    lineage: { parents: [] },
    createdAt,
    retention: { class: 'project' },
    locations: []
  });
  const writer = module.byteStore.begin({ artifactId: id, maxBytes: bytes.byteLength });
  await writer.write(bytes);
  await writer.commit({ key: cacheKey, hash, mime: 'model/gltf-binary', bytes: bytes.byteLength });
  module.artifactRegistry.updateLocation(id, {
    id: `${id}_location`,
    kind: 'local-cache',
    scope: 'application',
    state: 'available',
    verifiedAt: createdAt,
    access: { kind: 'cache-key', key: cacheKey }
  });
  module.artifactRegistry.verifyIntegrity(id, {
    hash,
    bytes: bytes.byteLength,
    mime: 'model/gltf-binary',
    verifiedAt: createdAt,
    method: 'test-sha256-v1'
  });
  return { id, hash, bytes };
}

describe('Asset module publishAsset public API', () => {
  it('fails closed until composition configures the compiler', async () => {
    const module = createAssetModule({ manifests: {}, now: () => NOW });
    await expect(module.publishAsset({ artifactId: 'artifact_missing', assetId: 'asset_missing' }))
      .rejects.toMatchObject({ code: 'ASSET_PUBLICATION_NOT_CONFIGURED' });
  });

  it('publishes a verified Artifact and returns the stable AssetRef', async () => {
    const module = createAssetModule({ manifests: {}, now: () => NOW });
    const compile = vi.fn(async ({ assetId, label }) => ({
      manifest: readyManifest(assetId, label),
      quality: { status: 'ready', hard: [], advisory: [] }
    }));
    module.configurePublication({
      getAssetCompiler: async () => ({ compile }),
      idFactory: () => 'lease_publication_01'
    });
    await registerVerifiedGlb(module);

    const result = await module.publishAsset({
      artifactId: 'artifact_publish_01',
      assetId: 'asset_publish_01',
      label: 'Published Asset'
    });

    expect(result).toMatchObject({
      status: 'asset-ready',
      registered: true,
      artifactId: 'artifact_publish_01',
      assetId: 'asset_publish_01',
      assetRef: { assetId: 'asset_publish_01' },
      admission: { status: 'ready', reasons: [] }
    });
    expect(module.manager.has('asset_publish_01')).toBe(true);
    expect(module.catalog.resolveExisting('Published Asset')).toMatchObject({
      status: 'found',
      assets: [{ id: 'asset_publish_01' }]
    });
    expect(compile).toHaveBeenCalledOnce();
  });

  it('reuses identical publication without recompiling', async () => {
    const module = createAssetModule({ manifests: {}, now: () => NOW });
    const compile = vi.fn(async ({ assetId }) => ({
      manifest: readyManifest(assetId),
      quality: { status: 'ready', hard: [], advisory: [] }
    }));
    module.configurePublication({
      getAssetCompiler: async () => ({ compile }),
      idFactory: () => 'lease_publication_reuse'
    });
    await registerVerifiedGlb(module);

    const request = { artifactId: 'artifact_publish_01', assetId: 'asset_publish_reuse' };
    const first = await module.publishAsset(request);
    const second = await module.publishAsset(request);

    expect(first.registered).toBe(true);
    expect(second).toMatchObject({
      status: 'asset-ready',
      registered: false,
      reused: true,
      assetRef: { assetId: 'asset_publish_reuse' }
    });
    expect(compile).toHaveBeenCalledOnce();
  });

  it('rejects a different Artifact trying to claim an existing assetId', async () => {
    const module = createAssetModule({ manifests: {}, now: () => NOW });
    const compile = vi.fn(async ({ assetId }) => ({
      manifest: readyManifest(assetId),
      quality: { status: 'ready', hard: [], advisory: [] }
    }));
    module.configurePublication({
      getAssetCompiler: async () => ({ compile }),
      idFactory: () => 'lease_publication_conflict'
    });
    await registerVerifiedGlb(module, { id: 'artifact_publish_01' });
    await module.publishAsset({ artifactId: 'artifact_publish_01', assetId: 'asset_shared' });
    await registerVerifiedGlb(module, {
      id: 'artifact_publish_02',
      bytes: new Uint8Array([9, 8, 7, 6])
    });

    await expect(module.publishAsset({ artifactId: 'artifact_publish_02', assetId: 'asset_shared' }))
      .rejects.toMatchObject({ code: 'ASSET_ID_CONFLICT' });
    expect(compile).toHaveBeenCalledOnce();
  });

  it('does not expose AssetRef or register when compilation is rejected', async () => {
    const module = createAssetModule({ manifests: {}, now: () => NOW });
    module.configurePublication({
      getAssetCompiler: async () => ({
        compile: async () => {
          const error = new Error('quality rejected');
          error.code = 'ASSET_COMPILE_REJECTED';
          error.details = { status: 'rejected', hard: ['BROKEN_GEOMETRY'] };
          throw error;
        }
      }),
      idFactory: () => 'lease_publication_rejected'
    });
    await registerVerifiedGlb(module);

    const result = await module.publishAsset({
      artifactId: 'artifact_publish_01',
      assetId: 'asset_rejected'
    });

    expect(result).toMatchObject({
      status: 'asset-rejected',
      registered: false,
      admission: { status: 'rejected', reasons: ['COMPILER_REJECTED'] }
    });
    expect(result).not.toHaveProperty('assetRef');
    expect(module.manager.has('asset_rejected')).toBe(false);
  });
});
