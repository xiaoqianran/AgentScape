import { it, expect } from 'vitest';
import * as THREE from 'three';
import { execFileSync } from 'node:child_process';
import { mkdtemp, cp, symlink, writeFile, rm, readFile, stat } from 'node:fs/promises';
import { resolve, dirname, basename } from 'node:path';
import { pathToFileURL } from 'node:url';

it('runs the bundled SDK without repository sources and creates a safe Starter', async () => {
  const directory = await mkdtemp(resolve('.tmp-sdk-'));
  try {
    execFileSync(process.execPath, ['dev/build-sdk.mjs', '--core', '--engine', '--snapshot', directory], { stdio: 'pipe' });
    await symlink(resolve('node_modules'), resolve(directory, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
    await writeFile(resolve(directory, 'package.json'), '{"type":"module"}');
    const { AgentScape } = await import(pathToFileURL(resolve(directory, 'dist/index.js')).href);
    // The default standalone package only provides the semantic extension.
    const { AgentScape: CoreAgentScape, attach } = await import(pathToFileURL(resolve(directory, 'core/index.js')).href);
    expect(CoreAgentScape.attach).toBe(attach);
    expect(CoreAgentScape).not.toHaveProperty('open');
    expect((await stat(resolve(directory, 'core/index.js'))).size).toBeLessThan(16384);
    const existing = new THREE.Scene(), mesh = new THREE.Group();
    existing.add(mesh);
    const semantics = attach(existing);
    semantics.register(mesh, { id: 'free-three-object', actions: { ping: () => 'pong' } });
    expect(await semantics.invoke('free-three-object', 'ping')).toBe('pong');
    semantics.dispose();
    expect(existing.children).toContain(mesh);
    expect(AgentScape.extend).toBeTypeOf('function');
    const manifest = JSON.parse(await readFile('sdk/typescript/package.json', 'utf8'));
    expect(manifest.dependencies || {}).toEqual({});
    expect(Object.keys(manifest.exports)).toEqual(['.', './core']);
    const engineManifest = JSON.parse(await readFile('sdk/engine/package.json', 'utf8'));
    expect(engineManifest.exports).toHaveProperty('./mcp');
    const world = await AgentScape.open();
    try {
      await world.addModel({ id: 'cup', asset: 'builtin://cup' });
      expect(world.observe().objects[0].id).toBe('cup');
      await world.addModel({ id: 'visual', asset: { schema: 'agentscape.asset-recipe', schemaVersion: 1, id: 'example/sdk', parts: [{ id: 'body', geometry: { type: 'box', size: [1, 1, 1] } }] } });
      expect(world.observe().objects.find(object => object.id === 'visual').physicsRegistered).toBe(false);
    } finally { world.close(); }
    const starter = resolve(directory, 'starter');
    execFileSync(process.execPath, ['sdk/engine/cli.mjs', 'starter', starter]);
    expect(await readFile(resolve(starter, 'main.js'), 'utf8')).toContain("from 'agentscape3d-engine'");
    expect(() => execFileSync(process.execPath, ['sdk/engine/cli.mjs', 'starter', starter], { stdio: 'pipe' })).toThrow();
  } finally {
    // mkdtemp returns a verified task-local path; no user paths are removed.
    if (dirname(directory) !== resolve('.') || !basename(directory).startsWith('.tmp-sdk-')) throw new Error('Unexpected temporary directory');
    await rm(directory, { recursive: true, force: true });
  }
}, 60000);
