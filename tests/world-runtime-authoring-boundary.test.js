import { describe, expect, it } from 'vitest';
import { attachLegacyAuthoring } from '../src/authoring/LegacyAuthoringShell.js';
import { createAssetModule } from '../src/assets/createAssetModule.js';
import { WorldRuntime } from '../src/runtime/WorldRuntime.js';

const createRuntime = () => new WorldRuntime({ appendChild() {} }, { environmentFactory: () => null, assetModule:createAssetModule() });

describe('WorldRuntime authoring boundary', () => {
  it('constructs a provider-neutral World core', () => {
    const runtime = createRuntime();

    expect(runtime.assets).toBeTruthy();
    expect(runtime.assetCatalog).toBeTruthy();
    expect(runtime.compiledAssetStore).toBeTruthy();
    for (const key of [
      'authoring',
      'assetLibrary',
      'assetGenerator',
      'compilerProvider',
      'generation',
      'generationState',
      'generationConnectorError',
      'getAssetCompiler'
    ]) {
      expect(Object.prototype.hasOwnProperty.call(runtime, key)).toBe(false);
    }
  });

  it('restores the legacy authoring surface only when explicitly attached', async () => {
    const runtime = createRuntime();
    const authoring = attachLegacyAuthoring(runtime, { storage: null, connectorClient: null });

    expect(runtime.authoring).toBe(authoring);
    expect(runtime.assetLibrary).toBe(authoring.assetLibrary);
    expect(runtime.assetGenerator).toBe(authoring.assetGenerator);
    expect(runtime.compilerProvider).toBe(authoring.compilerProvider);
    expect(runtime.generation).toBe(authoring.generation);
    expect(runtime.getAssetCompiler).toBe(authoring.getAssetCompiler);
    expect(runtime.generationConnectorError).toBeNull();

    const state = await authoring.initialize();
    expect(state).toEqual({ status: 'connection-required', reason: 'CONNECTOR_NOT_CONFIGURED' });
    expect(runtime.generationState).toEqual(state);
  });

  it('is idempotent for one runtime', () => {
    const runtime = createRuntime();
    const first = attachLegacyAuthoring(runtime, { storage: null, connectorClient: null });
    const second = attachLegacyAuthoring(runtime, { storage: null, connectorClient: null });
    expect(second).toBe(first);
  });
});
