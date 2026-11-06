#!/usr/bin/env node
import { mkdir, writeFile, readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const [command, target = 'my-agentscape-world'] = process.argv.slice(2);
if (command === 'mcp') {
  const { startServer } = await import('./dist/mcp.js');
  const app = await startServer({tokens:JSON.parse(process.env.AGENTSCAPE_MCP_TOKENS || '[]'),
    codeExecution:{mode:process.env.AGENTSCAPE_CODE_EXECUTION || 'worker-wasm',authorized:process.env.AGENTSCAPE_TRUSTED_CODE==='1',remote:process.env.AGENTSCAPE_PUBLIC_SERVICE==='1'}});
  console.log(`AgentScape MCP: http://127.0.0.1:${app.port}/mcp`);
  for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>app.close().then(()=>process.exit(0)));
} else if (command !== 'starter') {
  console.log('Usage: agentscape3d starter [new-directory] | mcp (alias: agentscape)');
  process.exitCode = command === '--help' || !command ? 0 : 1;
} else {
  const directory = resolve(target);
  await mkdir(directory, { recursive: true });
  if ((await readdir(directory)).length) throw new Error('Starter destination must be empty');
  const pkg = JSON.parse(await readFile(new URL('./package.json', import.meta.url), 'utf8'));
  const files = {
    'package.json': JSON.stringify({ name: 'my-agentscape-world', private: true, type: 'module', scripts: { dev: 'vite' }, dependencies: { 'agentscape3d': pkg.version }, devDependencies: { vite: '^8.2.2' } }, null, 2),
    'index.html': '<!doctype html><html><head><title>AgentScape world</title></head><body style="margin:0"><div id="app" style="width:100vw;height:100vh"></div><script type="module" src="/main.js"></script></body></html>',
    'main.js': `import { AgentScape } from 'agentscape3d';\nconst world = await AgentScape.open({canvas:'#app'});\nawait world.addModel({id:'table',asset:'builtin://table',position:[0,0,3]});\nawait world.addModel({id:'cup',asset:'builtin://cup',position:[2,0,2]});\nwindow.world = world;\n`
  };
  for (const [name, content] of Object.entries(files)) await writeFile(resolve(directory, name), content, { flag: 'wx' });
  console.log(`Created ${directory}. Run npm install in the new directory, then npm run dev.`);
}
