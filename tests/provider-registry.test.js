import { describe, expect, it, vi } from 'vitest';
import { ProviderRegistry, createDefaultProviderRegistry } from '../generation/providers/ProviderRegistry.js';
import { createLegacyAssetAuthoring, createLegacyAssetGenerationPort } from '../generation/orchestration/LegacyAuthoringShell.js';
import { AssetCatalog } from '../asset/AssetCatalog.js';
import { AssetManager } from '../asset/AssetManager.js';

describe('ProviderRegistry', () => {
  it('publishes the first provider batch without pretending disabled providers are available', () => {
    const registry = createDefaultProviderRegistry();
    expect(registry.listProviders().map((provider) => provider.id)).toEqual([
      'embodiedgen', 'legacy-http-generator', 'local-catalog', 'modal-2d', 'modal-3d'
    ]);
    expect(registry.findCapabilities({ availableOnly: true }).map((capability) => capability.operation)).toEqual([
      'local-catalog.asset.search.v1'
    ]);
  });

  it('discovers executable generation capabilities by provider/input/output', async () => {
    const generator = { isConfigured: () => true, generate: vi.fn(async (request) => ({ manifest: { id: request.prompt } })) };
    const registry = createDefaultProviderRegistry({ generator });
    const capability = registry.resolveCapability({ provider: 'legacy-http-generator', input: 'text', output: 'asset' });
    expect(capability).toMatchObject({
      provider: 'legacy-http-generator',
      operation: 'legacy-http-generator.asset.text_to_3d.v1',
      status: 'available',
      execution: { async: false }
    });
    await expect(registry.execute(capability, { prompt: 'chair' })).resolves.toEqual({ manifest: { id: 'chair' } });
  });

  it('keeps raw-provider consumption behind the capability binding', async () => {
    const generator = { isConfigured: () => true, generate: vi.fn(async () => ({ provider: 'embodiedgen', asset: { id: 'bench', glb_url: 'https://assets.test/bench.glb' } })) };
    const registry = createDefaultProviderRegistry({ generator });
    const capability = registry.resolveCapability({ provider: 'embodiedgen', input: 'text', output: 'asset' });
    const result = await registry.execute(capability, { prompt: 'bench', provider: 'embodiedgen' });
    const manifest = await registry.consume(capability, result, { request: { id: 'bench-runtime' } });
    expect(manifest).toMatchObject({
      id: 'bench-runtime',
      source: { kind: 'glb', url: 'https://assets.test/bench.glb' },
      provenance: { provider: 'embodiedgen', semantics: { verified: false } }
    });
  });

  it('rejects unstable operation IDs and duplicate providers', () => {
    const registry = new ProviderRegistry();
    expect(() => registry.registerProvider({
      id: 'example', status: 'available', health: 'healthy',
      capabilities: [{ operation: 'text_to_3d', status: 'available' }]
    })).toThrow(/stable provider-scoped ID/);
    registry.registerProvider({ id: 'example', status: 'available', health: 'healthy', capabilities: [] });
    expect(() => registry.registerProvider({ id: 'example', capabilities: [] })).toThrow(/already registered/);
  });

  it('does not expose mutation of registry descriptors through returned objects', () => {
    const registry = createDefaultProviderRegistry();
    const provider = registry.getProvider('local-catalog');
    provider.status = 'disabled';
    provider.capabilities[0].status = 'disabled';
    expect(registry.getProvider('local-catalog')).toMatchObject({ status: 'available', capabilities: [{ status: 'available' }] });
  });
});

it('lets legacy authoring consume a new provider without provider-specific branches', async () => {
  const registry = new ProviderRegistry();
  registry.registerProvider({
    id: 'custom-3d', version: '7', status: 'available', health: 'healthy',
    capabilities: [{
      operation: 'custom-3d.asset.text_to_3d.v1', status: 'available',
      input: { types: ['text'] }, output: { roles: ['asset'] },
      execution: { async: false }, consumption: { kind: 'custom-adapter' }
    }]
  });
  registry.bindCapability('custom-3d.asset.text_to_3d.v1', {
    execute: vi.fn(async () => ({ raw: { id: 'custom_widget' } })),
    consume: (result) => ({
      id: result.raw.id,
      type: 'object', label: 'Custom Widget', tags: ['custom'],
      source: { kind: 'glb', url: 'https://assets.test/custom.glb' },
      actions: ['move'], physics: { body: 'fixed', colliders: [] },
      provenance: { provider: 'custom-3d' }
    })
  });
  const assetManager = new AssetManager();
  const catalog = new AssetCatalog({ assetManager });
  const generationPort = createLegacyAssetGenerationPort({ providerRegistry: registry, generation: null, assetManager });
  const authoring = createLegacyAssetAuthoring({ assetManager, catalog, generationPort });
  const result = await authoring.generateAsset('custom widget', { provider: 'custom-3d' });
  expect(result).toMatchObject({ id: 'custom_widget', admission: { status: 'provisional' } });
  expect(assetManager.getManifest('custom_widget')).toMatchObject({ provenance: { provider: 'custom-3d' } });
});
