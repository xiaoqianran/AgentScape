#!/usr/bin/env node
import { stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createServer } from 'node:http';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export function startStudio({ host = '127.0.0.1', port = 4173 } = {}) {
  if (!Number.isInteger(Number(port)) || Number(port) < 0 || Number(port) > 65535) {
    throw new Error('Port must be an integer between 0 and 65535');
  }
  const root = resolve(fileURLToPath(new URL('./site/', import.meta.url)));
  const types = {
    '.css': 'text/css; charset=utf-8', '.html': 'text/html; charset=utf-8',
    '.ico': 'image/x-icon', '.jpeg': 'image/jpeg', '.jpg': 'image/jpeg',
    '.js': 'text/javascript; charset=utf-8', '.json': 'application/json',
    '.png': 'image/png', '.svg': 'image/svg+xml',
    '.wasm': 'application/wasm', '.webp': 'image/webp',
    '.woff': 'font/woff', '.woff2': 'font/woff2'
  };
  const server = createServer(async (request, response) => {
    if (!['GET', 'HEAD'].includes(request.method)) {
      response.writeHead(405, { Allow: 'GET, HEAD' }).end();
      return;
    }
    try {
      const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
      let file = resolve(root, pathname.replace(/^\/+/, ''));
      if (file !== root && !file.startsWith(root + sep)) {
        response.writeHead(403).end();
        return;
      }
      if (pathname.endsWith('/')) file = resolve(file, 'index.html');
      else {
        try {
          if ((await stat(file)).isDirectory()) file = resolve(file, 'index.html');
        } catch (error) {
          if (error.code !== 'ENOENT') throw error;
        }
      }
      const info = await stat(file);
      if (!info.isFile()) throw Object.assign(new Error('Missing file'), { code: 'ENOENT' });
      response.writeHead(200, {
        'Content-Type': types[extname(file).toLowerCase()] || 'application/octet-stream',
        'Content-Length': info.size, 'X-Content-Type-Options': 'nosniff'
      });
      if (request.method === 'HEAD') response.end();
      else createReadStream(file).pipe(response);
    } catch (error) {
      const notFound = error.code === 'ENOENT' || error instanceof URIError;
      response.writeHead(notFound ? 404 : 500, {
        'Content-Type': 'text/plain; charset=utf-8'
      }).end(notFound ? 'Not found' : 'Internal server error');
    }
  });
  return new Promise((done, fail) => {
    server.once('error', fail);
    server.listen(Number(port), host, () => {
      server.off('error', fail);
      done({ server, port: server.address().port, host });
    });
  });
}

export async function runStudioCli(args = process.argv.slice(2)) {
  const options = new Map();
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--help') {
      console.log('Usage: agentscape3d-studio [web] [--host 127.0.0.1] [--port 4173]');
      process.exit(0);
    }
    if (args[i] === 'web') continue;
    if (!['--host', '--port'].includes(args[i]) || !args[i + 1]) {
      throw new Error('Unknown or incomplete Studio option: ' + args[i]);
    }
    options.set(args[i], args[++i]);
  }
  const instance = await startStudio({
    host: options.get('--host') || process.env.AGENTSCAPE_WEB_HOST || '127.0.0.1',
    port: Number(options.get('--port') || process.env.AGENTSCAPE_WEB_PORT || 4173)
  });
  console.log('AgentScape Studio: http://' + instance.host + ':' + instance.port + '/ (Studio: /studio/)');
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.once(signal, () => instance.server.close(() => process.exit(0)));
  }
  return instance;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await runStudioCli();
