import { it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtemp, cp, symlink, writeFile, rm } from 'node:fs/promises';
import { resolve, dirname, basename } from 'node:path';
import { pathToFileURL } from 'node:url';
import { readFile } from 'node:fs/promises';
import { openScene } from '../../application/scene/SceneFacade.js';
import { createAssetModule } from '../../modules/asset/AssetModule.js';
import { assetManifests } from '../../modules/asset/registry/manifests/index.js';
import { installHeadlessAssetIO } from '../../apps/mcp-server/HeadlessAssetIO.js';

// APP-JOURNEY-003: the CabinetCup standard journey. The task world is arranged
// with repository internals and exported as a project bundle (the SDK's own
// starter manifest set has no cabinet); the journey itself is then driven
// only through the published TypeScript SDK surface (built dist in a clean
// directory): open({bundle}) -> interact open/pickup/place -> observe.
it('executes the CabinetCup journey through the TypeScript SDK', async () => {
  installHeadlessAssetIO();
  // Mirror dev/acceptance/worldHarness.mjs: the cabinet is a GLB asset, so
  // its manifest source is rewritten to a data URL for headless loading.
  const manifests = structuredClone(assetManifests);
  const cabinetBytes = await readFile(new URL('../../public/assets/cabinet.glb', import.meta.url));
  manifests.cabinet.source = { kind: 'glb', url: `data:model/gltf-binary;base64,${cabinetBytes.toString('base64')}` };
  const sourceAssets = createAssetModule({ manifests, manifestStore: null, libraryStore: null });
  const source = await openScene({ assetModule: sourceAssets, project: {
    schema: 'agentscape.scene-project', schemaVersion: 1, name: 'CabinetCup via SDK',
    environment: { type: 'builtin', id: 'monument-hall' },
    objects: [
      { id: 'agent_01', asset: 'builtin://agent', level: 'physical', transform: { position: [0, 0, 9] } },
        { id: 'cabinet_01', asset: 'builtin://cabinet', level: 'physical', transform: { position: [-5.2, 0, 3.9] } },
        { id: 'cup_01', asset: 'builtin://cup', level: 'physical', transform: { position: [-5.2, 0.17, 3.89] } },
        { id: 'table_01', asset: 'builtin://table', level: 'physical', transform: { position: [5.2, 0, 4.2] } }
    ]
  } });
  let bundle;
  try { bundle = (await source.save()).value; } finally { source.close(); }

  execFileSync(process.execPath, ['dev/build-sdk.mjs'], { stdio: 'pipe' });
  const directory = await mkdtemp(resolve('.tmp-sdk-journey-'));
  try {
    await cp('sdk/typescript/dist', resolve(directory, 'dist'), { recursive: true });
    await symlink(resolve('node_modules'), resolve(directory, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
    await writeFile(resolve(directory, 'package.json'), '{"type":"module"}');
    const { AgentScape } = await import(pathToFileURL(resolve(directory, 'dist/index.js')).href);
    const scene = await AgentScape.open({ bundle, autoStart: false });
    try {
      const finish = async (job, limit = 4000) => {
        for (let frame = 0; frame < limit && scene.getJob(job.id).status === 'running'; frame++) {
          scene.step();
          if (frame % 12 === 0) await new Promise(r => setTimeout(r, 0)); else await Promise.resolve();
        }
        expect(scene.getJob(job.id).status).not.toBe('running');
        return scene.waitJob(job.id);
      };
      const run = async (input) => {
        const done = await finish(scene.interact(input));
        expect(done.status, JSON.stringify(done)).toBe('succeeded');
        expect(done.result?.verification?.status).toBe('verified');
        return done;
      };
      await run({ action: 'open', actor: 'agent_01', target: 'cabinet_01' });
      await run({ action: 'pickup', actor: 'agent_01', target: 'cup_01' });
      await run({ action: 'place', actor: 'agent_01', target: 'table_01', surfaceId: 'top' });
      const cup = scene.observe().objects.find(object => object.id === 'cup_01');
      expect(cup).toBeTruthy();
      const position = cup.position ?? cup.transform?.position;
      expect(position).toBeTruthy();
      expect(Math.hypot(position[0] - 5.2, position[2] - 4.2)).toBeLessThan(0.6);
      expect(position[1]).toBeGreaterThan(0.6);
      expect(position[1]).toBeLessThan(1.3);
    } finally { scene.close(); }
  } finally {
    if (dirname(directory) !== resolve('.') || !basename(directory).startsWith('.tmp-sdk-journey-')) throw new Error('Unexpected temporary directory');
    await rm(directory, { recursive: true, force: true });
  }
}, 180000);
