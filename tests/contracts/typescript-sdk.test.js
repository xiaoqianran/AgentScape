import { it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtemp, cp, symlink, writeFile, rm, readFile } from 'node:fs/promises';
import { resolve, dirname, basename } from 'node:path';
import { pathToFileURL } from 'node:url';

it('runs the bundled SDK without repository sources and creates a safe Starter', async () => {
  execFileSync(process.execPath, ['dev/build-sdk.mjs'], { stdio: 'pipe' });
  const directory = await mkdtemp(resolve('.tmp-sdk-'));
  try {
    await cp('sdk/typescript/dist', resolve(directory, 'dist'), { recursive: true });
    await symlink(resolve('node_modules'), resolve(directory, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
    await writeFile(resolve(directory, 'package.json'), '{"type":"module"}');
    const { AgentScape } = await import(pathToFileURL(resolve(directory, 'dist/index.js')).href);
    const world = await AgentScape.open();
    try {
      await world.addModel({ id: 'cup', asset: 'builtin://cup' });
      expect(world.observe().objects[0].id).toBe('cup');
      await world.addModel({ id: 'visual', asset: { schema: 'agentscape.asset-recipe', schemaVersion: 1, id: 'example/sdk', parts: [{ id: 'body', geometry: { type: 'box', size: [1, 1, 1] } }] } });
      expect(world.observe().objects.find(object => object.id === 'visual').physicsRegistered).toBe(false);
    } finally { world.close(); }
    const starter = resolve(directory, 'starter');
    execFileSync(process.execPath, ['sdk/typescript/cli.mjs', 'starter', starter]);
    expect(await readFile(resolve(starter, 'main.js'), 'utf8')).toContain("from '@agentscape/sdk'");
    expect(() => execFileSync(process.execPath, ['sdk/typescript/cli.mjs', 'starter', starter], { stdio: 'pipe' })).toThrow();
  } finally {
    // mkdtemp returns a verified task-local path; no user paths are removed.
    if (dirname(directory) !== resolve('.') || !basename(directory).startsWith('.tmp-sdk-')) throw new Error('Unexpected temporary directory');
    await rm(directory, { recursive: true, force: true });
  }
}, 60000);
