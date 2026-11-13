import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join, dirname, basename } from 'node:path';
import { createHash } from 'node:crypto';

// Run with npm run sdk:verify so npm's own CLI path is explicit, without shell interpolation.
const npmCli = process.env.npm_execpath;
if (!npmCli) throw new Error('Run npm run sdk:verify');
const root = resolve(import.meta.dirname, '..');
const temporary = mkdtempSync(join(tmpdir(), 'agentscape-sdk-verify-'));
const npm = (args, cwd) => execFileSync(process.execPath, [npmCli, ...args], { cwd, encoding: 'utf8', stdio: ['pipe', 'pipe', 'inherit'] });
try {
  execFileSync(process.execPath, ['dev/build-sdk.mjs'], { cwd: root, stdio: 'inherit' });
  // npm lifecycle scripts can print to stdout before the pack JSON payload.
  // Parse the final top-level JSON envelope instead of assuming clean stdout.
  const packOutput = npm(['pack', '--json', '--silent', '--pack-destination', temporary], join(root, 'sdk/typescript'));
  const jsonStart = Math.max(packOutput.lastIndexOf('\n{'), packOutput.lastIndexOf('\n['));
  if (jsonStart < 0) throw new Error('SDK package metadata JSON missing');
  const packedResult = JSON.parse(packOutput.slice(jsonStart + 1));
  const packed = Array.isArray(packedResult) ? packedResult[0] : packedResult['agentscape3d'];
  if (!packed?.filename) throw new Error('SDK package metadata missing');
  const consumer = join(temporary, 'consumer'); mkdirSync(consumer);
  writeFileSync(join(consumer, 'package.json'), JSON.stringify({ name: 'agentscape-clean-consumer', private: true, type: 'module' }));
  const installation = npm(['install', '--ignore-scripts', join(temporary, packed.filename)], consumer);
  writeFileSync(join(consumer, 'table.json'), readFileSync(join(root, 'examples/recipes/table.json')));
  writeFileSync(join(consumer, 'create.mjs'), `
import { AgentScape } from 'agentscape3d';
import { readFile, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const scene = await AgentScape.open();
try {
 const asset = JSON.parse(await readFile('table.json','utf8'));
 const result = await scene.addModel({id:'table',asset,level:'physical'});
 assert.equal(result.status,'succeeded');
 await scene.setStyle('builtin://toon');
 await writeFile('project.json',JSON.stringify((await scene.save()).value));
} finally {scene.close();}
`);
  writeFileSync(join(consumer, 'restore.mjs'), `
import { AgentScape } from 'agentscape3d';
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const scene = await AgentScape.open({bundle:JSON.parse(await readFile('project.json','utf8'))});
try {
 const state=scene.observe();
 assert.equal(state.objects.length,1); assert.equal(state.objects[0].physicsRegistered,true);
 assert.equal(state.style.id,'builtin/toon');
 console.log(JSON.stringify({freshProcess:true,objects:1,physics:true,style:'builtin/toon'}));
} finally {scene.close();}
`);
  execFileSync(process.execPath, ['create.mjs'], { cwd: consumer, stdio: 'inherit' });
  const restoration = execFileSync(process.execPath, ['restore.mjs'], { cwd: consumer, encoding: 'utf8' });
  writeFileSync(join(consumer, 'code.mjs'), `
import { AgentScape } from 'agentscape3d';
import { startServer } from 'agentscape3d/mcp';
import assert from 'node:assert/strict';
const world=await AgentScape.open({codeExecution:{mode:'worker-wasm'}});
let restored;
try {
 await world.addModel({id:'code_cube',asset:{kind:'three-code',source:'export function createAsset(THREE) { const g=new THREE.Group(); g.add(new THREE.Mesh(new THREE.BoxGeometry(1,1,1),new THREE.MeshStandardMaterial())); return g; }'}});
 const bundle=(await world.save()).value;
 world.close();
 restored=await AgentScape.open({bundle});
 assert.equal(restored.observe().objects[0].id,'code_cube');
 const server=await startServer({tokens:[{identity:'test',token:'standalone-sdk-test-token-32-characters'}],port:0,root:'.sessions',dataRoot:'.assets'});
 await server.close();
 console.log('Installed SDK code Worker, save/restore and MCP entry passed');
} finally {restored?.close();world.close();}
`);
  execFileSync(process.execPath, ['code.mjs'], { cwd: consumer, stdio: 'inherit' });
  // A clean consumer must share the same Three.js constructors with NativeSceneHost.
  writeFileSync(join(consumer, 'native.mjs'), `
import { AgentScape, attachNativeScene } from 'agentscape3d';
import * as THREE from 'three';
import assert from 'node:assert/strict';
assert.equal(AgentScape.attach, attachNativeScene);
const scene = new THREE.Scene();
const retained = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
scene.add(retained);
const renderer = {
  render() { throw new Error('HOST_RENDER_CALLED'); },
  dispose() { throw new Error('HOST_RENDERER_DISPOSED'); },
  extensions: { has: () => false }
};
const renderBefore = renderer.render;
const session = await AgentScape.attach({
  scene, camera: new THREE.PerspectiveCamera(), renderer, autoStart: false,
  colliders: [{ shape: 'box', halfExtents: [8, .1, 8], translation: [0, -.1, 0] }]
});
try {
  assert.equal(session.scene.native.scene, scene);
  assert.equal(session.scene.capabilities.ownsRenderer, false);
  const result = await session.scene.addModel({
    id: 'consumer_native_cup', asset: 'builtin://cup', position: [0, 2, 0]
  });
  assert.equal(result.status, 'succeeded');
  assert.equal(session.scene.observe().objects[0].physicsRegistered, true);
  assert.equal(scene.children.includes(session.scene.native.root), true);
  await assert.rejects(session.scene.save(), error => error.code === 'NATIVE_PROJECT_SAVE_UNSUPPORTED');
} finally {
  session.close();
}
assert.deepEqual(scene.children, [retained]);
assert.equal(renderer.render, renderBefore);
retained.geometry.dispose();
retained.material.dispose();
console.log('Installed SDK native Three.js attach, physics, detach and instance identity passed');
`);
  execFileSync(process.execPath, ['native.mjs'], { cwd: consumer, stdio: 'inherit' });
  writeFileSync(join(consumer, 'portal-source.json'), readFileSync(join(root, 'public/code-projects/portal.json')));
  writeFileSync(join(consumer, 'code-project-create.mjs'), `
import {AgentScape,parseCodeProject} from 'agentscape3d';
import {readFile,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const project=await parseCodeProject(await readFile('portal-source.json','utf8'));
const host=await AgentScape.openProject({project,authorized:true,autoStart:false});
try {
 const api=host.scene;
 assert.equal(api.observe().project.total,2);
 const job=api.interact({action:'custom',target:'portal',name:'teleport',args:{destination:'garden'}});
 assert.equal((await api.waitJob(job.id)).result.verification.status,'verified');
 await api.addModel({id:'table',asset:JSON.parse(await readFile('table.json','utf8')),level:'physical'});
 await writeFile('code-project.json',JSON.stringify((await api.save()).value));
} finally {host.close();}
`);
  writeFileSync(join(consumer, 'code-project-restore.mjs'), `
import {AgentScape} from 'agentscape3d';
import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const host=await AgentScape.openProject({project:await readFile('code-project.json','utf8'),authorized:true,autoStart:false});
try {
 assert.equal(host.scene.inspect('traveller').state.zone,'garden');
 assert.equal(host.scene.observe().objects[0].id,'table');
 const job=host.scene.interact({action:'custom',target:'portal',name:'teleport',args:{destination:'entrance'}});
 assert.equal((await host.scene.waitJob(job.id)).result.verification.status,'verified');
 console.log('Installed SDK code project and fresh-process behavior/state/assets restore passed');
} finally {host.close();}
`);
  execFileSync(process.execPath, ['code-project-create.mjs'], { cwd: consumer, stdio: 'inherit' });
  execFileSync(process.execPath, ['code-project-restore.mjs'], { cwd: consumer, stdio: 'inherit' });
  const report = { version: packed.version, node: process.version, platform: process.platform,
    sha256: createHash('sha256').update(readFileSync(join(temporary, packed.filename))).digest('hex'),
    files: packed.files.map(file => file.path), installation, restoration: JSON.parse(restoration.trim()) };
  mkdirSync(join(root, '.tmp-release'), { recursive: true });
  writeFileSync(join(root, '.tmp-release/sdk-install.json'), JSON.stringify(report, null, 2));
  console.log('Standalone SDK installation and fresh-process project restore passed');
} finally {
  if (dirname(temporary) !== resolve(tmpdir()) || !basename(temporary).startsWith('agentscape-sdk-verify-')) throw new Error('Unsafe cleanup path');
  rmSync(temporary, { recursive: true, force: true });
}
