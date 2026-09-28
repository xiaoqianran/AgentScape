import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { validateRepositoryArchitecture } from '../../dev/validate-repository-architecture.mjs';
import { validateDomainBoundaries } from '../../dev/validate-domain-boundaries.mjs';
import { validateConvergence } from '../../dev/validate-convergence.mjs';
import { validateAssetManifests } from '../../dev/validate-assets.mjs';

function makeRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'agentscape-validator-fixture-'));
}

function write(root, relative, content) {
  const file = path.join(root, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

// Minimal GLB the validator's node reader accepts: 20-byte header plus a padded JSON chunk.
function buildGlb(nodeNames) {
  const json = Buffer.from(JSON.stringify({ nodes: nodeNames.map((name) => ({ name })) }), 'utf8');
  const padding = (4 - (json.length % 4)) % 4;
  const jsonChunk = padding ? Buffer.concat([json, Buffer.alloc(padding, 0x20)]) : json;
  const glb = Buffer.alloc(20 + jsonChunk.length);
  glb.write('glTF', 0, 'ascii');
  glb.writeUInt32LE(2, 4);
  glb.writeUInt32LE(glb.length, 8);
  glb.writeUInt32LE(jsonChunk.length, 12);
  glb.write('JSON', 16, 'ascii');
  jsonChunk.copy(glb, 20);
  return glb;
}

describe('repository architecture validator (CI-008)', () => {
  it('accepts a repository that owns sdk/python in-repo', () => {
    const root = makeRoot();
    write(root, 'sdk/python/pyproject.toml', '[project]\nname = "agentscape"\n');
    expect(validateRepositoryArchitecture(root)).toEqual({ failures: [], submoduleCount: 0 });
  });

  it('fails when the in-repo Python SDK package is missing', () => {
    const root = makeRoot();
    const { failures } = validateRepositoryArchitecture(root);
    expect(failures).toEqual(['sdk/python: in-repo Python SDK package is missing pyproject.toml']);
  });

  it('captures provider repositories pinned as submodules', () => {
    const root = makeRoot();
    write(root, 'sdk/python/pyproject.toml', '[project]\nname = "agentscape"\n');
    write(root, '.gitmodules', '[submodule "providers/modal"]\n\tpath = providers/modal\n\turl = https://example.com/modal.git\n');
    const { failures } = validateRepositoryArchitecture(root);
    expect(failures).toContain('providers/modal: provider repositories must not be pinned as submodules');
  });

  it('captures sdk/python pinned as a submodule', () => {
    const root = makeRoot();
    write(root, '.gitmodules', '[submodule "sdk/python"]\n\tpath = sdk/python\n\turl = https://example.com/sdk.git\n');
    const { failures } = validateRepositoryArchitecture(root);
    expect(failures).toContain('sdk/python: Python SDK must be owned by the AgentScape monorepo, not pinned as a submodule');
  });
});

describe('domain boundary validator (CI-009)', () => {
  it('accepts a minimal product tree that keeps generation orchestration in application', () => {
    const root = makeRoot();
    write(root, 'application/generation/GenerationOrchestrator.js', 'export {};\n');
    const { failures } = validateDomainBoundaries(root);
    expect(failures).toEqual([]);
  });

  it('captures a product import into apps/observatory', () => {
    const root = makeRoot();
    write(root, 'application/generation/GenerationOrchestrator.js', 'export {};\n');
    write(root, 'apps/studio/usesObservatory.js', "import { inspect } from '../observatory/inspect.js';\nexport { inspect };\n");
    const { failures } = validateDomainBoundaries(root);
    expect(failures).toContain('Observatory ownership violation: apps/studio/usesObservatory.js -> apps/observatory/inspect.js');
  });

  it('captures a returning legacy root directory', () => {
    const root = makeRoot();
    write(root, 'application/generation/GenerationOrchestrator.js', 'export {};\n');
    write(root, 'src/legacy.js', 'export {};\n');
    const { failures } = validateDomainBoundaries(root);
    expect(failures).toContain('Legacy root directory must not return: src/');
  });
});

describe('convergence validator (CI-010)', () => {
  function writeConvergenceFixture(root) {
    write(root, 'package.json', JSON.stringify({ scripts: { dev: 'vite --host 127.0.0.1' } }));
    write(root, 'vite.config.js', "export default {\n  server: { host: '127.0.0.1' },\n  envPrefix: 'AGENTSCAPE_DEV_HOST'\n};\n");
    write(root, 'modules/agent/ToolCallingAgent.js', 'export {};\n');
    write(root, 'modules/agent/prompt/index.js', 'export {};\n');
    write(root, 'application/skills/registerCoreSkills.js', 'export const registerCoreSkills = (registry) => registry;\n');
    fs.mkdirSync(path.join(root, 'application', 'skills', 'packs'), { recursive: true });
    write(root, 'modules/generation/providers/ProviderRegistry.js', 'export const providers = {};\n');
    write(root, 'sdk/python/agentscape/settings.py', '# settings\n');
  }

  it('accepts a converged fixture', () => {
    const root = makeRoot();
    writeConvergenceFixture(root);
    expect(validateConvergence(root)).toEqual([]);
  });

  it('captures a returning retired surface directory', () => {
    const root = makeRoot();
    writeConvergenceFixture(root);
    write(root, 'modules/generation/artifacts/LegacyAuthoringShell.js', 'export {};\n');
    expect(validateConvergence(root)).toContain('Retired surface must not return: modules/generation/artifacts');
  });

  it('captures a ProviderRegistry that hard-codes a remote provider id', () => {
    const root = makeRoot();
    writeConvergenceFixture(root);
    write(root, 'modules/generation/providers/ProviderRegistry.js', 'export const providers = { "modal-3d": {} };\n');
    expect(validateConvergence(root)).toContain('ProviderRegistry must not hard-code remote Provider id: modal-3d');
  });
});

describe('asset validator (CI-011)', () => {
  it('locates every invalid fixture manifest with id, source url and reason', async () => {
    const manifests = {
      missingType: { id: 'missing-type', source: { kind: 'builtin' } },
      missingUrl: { id: 'missing-url', type: 'prop', actions: [], source: { kind: 'glb' } }
    };
    const { failures, checked } = await validateAssetManifests(manifests);
    expect(checked).toBe(0);
    expect(failures).toHaveLength(2);
    expect(failures[0]).toContain('missing-type');
    expect(failures[0]).toContain('Manifest requires string type');
    expect(failures[1]).toContain('missing-url (unknown source url)');
    expect(failures[1]).toContain('GLB source requires url');
  });

  it('reports the file and missing node names for a GLB manifest', async () => {
    const manifests = {
      cup: { id: 'cup', type: 'prop', actions: [], source: { kind: 'glb', url: '/assets/cup.glb' }, requiredNodes: ['Body', 'Lid'] }
    };
    const { failures } = await validateAssetManifests(manifests, { readGlbFile: async () => buildGlb(['Body']) });
    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain('cup.glb');
    expect(failures[0]).toContain('missing GLB nodes: Lid');
  });

  it('counts a GLB manifest whose required nodes are all present', async () => {
    const manifests = {
      cup: { id: 'cup', type: 'prop', actions: [], source: { kind: 'glb', url: '/assets/cup.glb' }, requiredNodes: ['Body'] }
    };
    const logged = [];
    const { failures, checked } = await validateAssetManifests(manifests, {
      readGlbFile: async () => buildGlb(['Body']),
      log: (line) => logged.push(line)
    });
    expect(failures).toEqual([]);
    expect(checked).toBe(1);
    expect(logged[0]).toContain('cup.glb');
  });
});
