import { describe, it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';

const read = async filename => JSON.parse(await readFile(new URL(filename, import.meta.url), 'utf8'));

describe('npm release package boundaries', () => {
  it('keeps agentscape3d a dependency-free semantic extension', async () => {
    const core = await read('../../sdk/typescript/package.json');
    expect(core.name).toBe('agentscape3d');
    expect(core.dependencies || {}).toEqual({});
    expect(Object.keys(core.exports)).toEqual(['.', './core']);
    expect(core.bin).toBeUndefined();
    expect(core.files).not.toContain('site');
    expect(core.peerDependencies.three).toBeTruthy();

    const source = await readFile(new URL('../../sdk/typescript/src/index.ts', import.meta.url), 'utf8');
    expect(source).toContain("from './core.js'");
    expect(source).not.toMatch(/(?:WorldRuntime|MCP|TaskSpec|Studio|NativeSceneHost|SceneFacade)/);
  });

  it('only loads the previous WorldRuntime through the optional engine package', async () => {
    const engine = await read('../../sdk/engine/package.json');
    expect(engine.name).toBe('agentscape3d-engine');
    expect(engine.exports).toHaveProperty('./mcp');
    expect(engine.exports).toHaveProperty('./node');
    expect(engine.dependencies['@dimforge/rapier3d-compat']).toBeTruthy();
    expect(engine.files).not.toContain('site');
  });

  it('installs Studio as a separate static website with no engine dependencies', async () => {
    const studio = await read('../../sdk/studio/package.json');
    expect(studio.name).toBe('agentscape3d-studio');
    expect(studio.dependencies || {}).toEqual({});
    expect(studio.files).toContain('site');
    expect(studio.files).not.toContain('dist');
    expect(studio.exports['./cli']).toBe('./cli.mjs');
    expect(studio.exports['.']).toBe('./cli.mjs');
  });
});
