import { describe, expect, it } from 'vitest';
import { ProgrammaticAssetBuilder } from '../../application/programmatic-assets/ProgrammaticAssetBuilder.js';
import { createCodeExecutor } from '../../apps/mcp-server/CodeExecutor.js';
import { createHeadlessGLTFLoader } from '../../apps/mcp-server/HeadlessGLTFLoader.js';
import { installHeadlessAssetIO } from '../../apps/mcp-server/HeadlessAssetIO.js';
import { appleTree } from '../../apps/mcp-server/examples/procedural-assets.js';

describe('apple tree procedural asset', () => {
  it('builds a structured tree with interactive apples and fixed trunk physics', async () => {
    installHeadlessAssetIO();
    const runner = createCodeExecutor({ mode: 'trusted-local', authorized: true });
    try {
      const result = await new ProgrammaticAssetBuilder({ runner, gltfLoader: createHeadlessGLTFLoader() }).build({
        source: appleTree.source,
        definition: appleTree.definition,
        assetId: 'apple-tree'
      });
      expect(result.validation.execution).toBe('succeeded');
      expect(result.admission.status).toBe('ready');
      expect(result.manifest.capabilityLevel).toBe('interactive');
      expect(result.validation.nodes).toEqual(expect.arrayContaining(['AppleTree', 'Trunk', 'Crown', 'Apple_01', 'Apple_05']));
      expect(Object.keys(result.manifest.parts)).toHaveLength(5);
      expect(result.manifest.physics.body).toBe('fixed');
      expect(Object.values(result.manifest.parts).every(part => part.physics.body === 'dynamic')).toBe(true);
      expect(Object.values(result.manifest.parts).every(part => part.actions.includes('pickup'))).toBe(true);
    } finally {
      runner.close();
    }
  }, 60000);
});
