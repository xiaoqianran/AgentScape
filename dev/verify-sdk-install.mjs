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
  const packedResult = JSON.parse(npm(['pack', '--json', '--pack-destination', temporary], join(root, 'sdk/typescript')));
  const packed = Array.isArray(packedResult) ? packedResult[0] : packedResult['@agentscape/sdk'];
  if (!packed?.filename) throw new Error('SDK package metadata missing');
  const consumer = join(temporary, 'consumer'); mkdirSync(consumer);
  writeFileSync(join(consumer, 'package.json'), JSON.stringify({ name: 'agentscape-clean-consumer', private: true, type: 'module' }));
  const installation = npm(['install', '--ignore-scripts', join(temporary, packed.filename)], consumer);
  writeFileSync(join(consumer, 'table.json'), readFileSync(join(root, 'examples/recipes/table.json')));
  writeFileSync(join(consumer, 'create.mjs'), `
import { AgentScape } from '@agentscape/sdk';
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
import { AgentScape } from '@agentscape/sdk';
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
import { AgentScape } from '@agentscape/sdk';
import { startServer } from '@agentscape/sdk/mcp';
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
