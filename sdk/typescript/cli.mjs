#!/usr/bin/env node
import { mkdir, writeFile, readdir, readFile, stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createServer } from 'node:http';
import { resolve, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const [command, ...args] = process.argv.slice(2);
if (command === 'mcp') {
  const { startServer } = await import('./dist/mcp.js');
  const app = await startServer({tokens:JSON.parse(process.env.AGENTSCAPE_MCP_TOKENS || '[]'),
    codeExecution:{mode:process.env.AGENTSCAPE_CODE_EXECUTION || 'worker-wasm',authorized:process.env.AGENTSCAPE_TRUSTED_CODE==='1',remote:process.env.AGENTSCAPE_PUBLIC_SERVICE==='1'}});
  console.log(`AgentScape MCP: http://127.0.0.1:${app.port}/mcp`);
  for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>app.close().then(()=>process.exit(0)));
} else if (command === 'web') {
  const options = new Map();
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--help') {
      console.log('Usage: agentscape3d web [--host 127.0.0.1] [--port 4173]');
      process.exit(0);
    }
    if (!['--host', '--port'].includes(args[i]) || !args[i + 1]) throw new Error(`Unknown or incomplete web option: ${args[i]}`);
    options.set(args[i], args[++i]);
  }
  const host = options.get('--host') || process.env.AGENTSCAPE_WEB_HOST || '127.0.0.1';
  const port = Number(options.get('--port') || process.env.AGENTSCAPE_WEB_PORT || 4173);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Web port must be an integer from 0 to 65535');
  const siteRoot = resolve(fileURLToPath(new URL('./site/', import.meta.url)));
  const mime = { '.css': 'text/css; charset=utf-8', '.html': 'text/html; charset=utf-8', '.ico': 'image/x-icon', '.jpeg': 'image/jpeg', '.jpg': 'image/jpeg', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.wasm': 'application/wasm', '.webp': 'image/webp', '.woff': 'font/woff', '.woff2': 'font/woff2' };
  const server = createServer(async (request, response) => {
    if (!['GET', 'HEAD'].includes(request.method)) { response.writeHead(405, { Allow: 'GET, HEAD' }).end(); return; }
    try {
      const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
      const relative = pathname.replace(/^\/+/, '');
      let file = resolve(siteRoot, relative);
      if (file !== siteRoot && !file.startsWith(`${siteRoot}${sep}`)) { response.writeHead(403).end(); return; }
      if (pathname.endsWith('/')) file = resolve(file, 'index.html');
      else {
        try { if ((await stat(file)).isDirectory()) file = resolve(file, 'index.html'); }
        catch (error) { if (error.code !== 'ENOENT') throw error; }
      }
      const info = await stat(file);
      if (!info.isFile()) throw Object.assign(new Error('Not found'), { code: 'ENOENT' });
      response.writeHead(200, { 'Content-Type': mime[extname(file).toLowerCase()] || 'application/octet-stream', 'Content-Length': info.size, 'X-Content-Type-Options': 'nosniff' });
      if (request.method === 'HEAD') response.end(); else createReadStream(file).pipe(response);
    } catch (error) {
      response.writeHead(error.code === 'ENOENT' || error instanceof URIError ? 404 : 500, { 'Content-Type': 'text/plain; charset=utf-8' }).end(error.code === 'ENOENT' || error instanceof URIError ? 'Not found' : 'Internal server error');
    }
  });
  server.listen(port, host, () => console.log(`AgentScape Web: http://${host}:${server.address().port}/ (Studio: /studio/)`));
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => server.close(() => process.exit(0)));
} else if (command !== 'starter') {
  console.log('Usage: agentscape3d web [--host host] [--port port] | starter [new-directory] | mcp (alias: agentscape)');
  process.exitCode = command === '--help' || !command ? 0 : 1;
} else {
  const target = args[0] || 'my-agentscape-world';
  const directory = resolve(target);
  await mkdir(directory, { recursive: true });
  if ((await readdir(directory)).length) throw new Error('Starter destination must be empty');
  const pkg = JSON.parse(await readFile(new URL('./package.json', import.meta.url), 'utf8'));
  const files = {
    'package.json': JSON.stringify({ name: 'my-agentscape-world', private: true, type: 'module', scripts: { dev: 'vite' }, dependencies: { 'agentscape3d': pkg.version }, devDependencies: { vite: '^8.2.2' } }, null, 2),
    'index.html': '<!doctype html><html><head><title>AgentScape SDK Starter</title></head><body style="margin:0"><div id="app" style="width:100vw;height:100vh"></div><script type="module" src="/main.js"></script></body></html>',
    'main.js': `import { AgentScape } from 'agentscape3d';\nconst world = await AgentScape.open({canvas:'#app'});\nawait world.addModel({id:'table',asset:'builtin://table',position:[0,0,3]});\nawait world.addModel({id:'cup',asset:'builtin://cup',position:[2,0,2]});\nwindow.world = world;\n`
  };
  for (const [name, content] of Object.entries(files)) await writeFile(resolve(directory, name), content, { flag: 'wx' });
  console.log(`Created ${directory}. Run npm install in the new directory, then npm run dev.`);
}
