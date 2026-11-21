#!/usr/bin/env node
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const [command, ...args] = process.argv.slice(2);

if (command === 'mcp') {
  const { startServer } = await import('./dist/mcp.js');
  const server = await startServer({
    tokens: JSON.parse(process.env.AGENTSCAPE_MCP_TOKENS || '[]'),
    codeExecution: {
      mode: process.env.AGENTSCAPE_CODE_EXECUTION || 'worker-wasm',
      authorized: process.env.AGENTSCAPE_TRUSTED_CODE === '1',
      remote: process.env.AGENTSCAPE_PUBLIC_SERVICE === '1'
    }
  });
  console.log('AgentScape MCP: http://127.0.0.1:' + server.port + '/mcp');
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.once(signal, () => server.close().then(() => process.exit(0)));
  }
} else if (command === 'web') {
  // No website is bundled with the engine. This is a convenience forwarding path.
  try {
    const { runStudioCli } = await import('agentscape3d-studio/cli');
    await runStudioCli(args);
  } catch (error) {
    if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error;
    console.error('Install the optional agentscape3d-studio package to run the web command.');
    process.exitCode = 1;
  }
} else if (command === 'starter') {
  const directory = resolve(args[0] || 'my-agentscape-world');
  await mkdir(directory, { recursive: true });
  if ((await readdir(directory)).length) throw new Error('Starter destination must be empty');
  const pkg = JSON.parse(await readFile(new URL('./package.json', import.meta.url), 'utf8'));
  const files = {
    'package.json': JSON.stringify({
      name: 'my-agentscape-world', private: true, type: 'module',
      scripts: { dev: 'vite' },
      dependencies: { 'agentscape3d-engine': pkg.version, three: '^0.187.0' },
      devDependencies: { vite: '^8.2.2' }
    }, null, 2),
    'index.html': '<!doctype html><html><head><title>AgentScape Engine Starter</title></head><body style="margin:0"><div id="app" style="width:100vw;height:100vh"></div><script type="module" src="/main.js"></script></body></html>',
    'main.js': "import { AgentScape } from 'agentscape3d-engine';\nconst world = await AgentScape.open({canvas:'#app'});\nawait world.addModel({id:'table',asset:'builtin://table',position:[0,0,3]});\nawait world.addModel({id:'cup',asset:'builtin://cup',position:[2,0,2]});\nwindow.world = world;\n"
  };
  for (const [name, text] of Object.entries(files)) {
    await writeFile(resolve(directory, name), text, { flag: 'wx' });
  }
  console.log('Created ' + directory + '. Run npm install, then npm run dev.');
} else {
  console.log('Usage: agentscape3d-engine starter [directory] | mcp | web (requires agentscape3d-studio)');
  process.exitCode = command === '--help' || !command ? 0 : 1;
}
