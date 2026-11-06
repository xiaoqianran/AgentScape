import { rolldown } from 'rolldown';
import { readFile, writeFile, mkdir, copyFile, rm, lstat, cp } from 'node:fs/promises';
import { isAbsolute, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = new URL('../', import.meta.url);
const source = new URL('sdk/typescript/', root);
const pkg = JSON.parse(await readFile(new URL('package.json', root), 'utf8'));
const sdk = JSON.parse(await readFile(new URL('package.json', source), 'utf8'));
// SDK releases are versioned independently from the private monorepo.
const referenced = new Set();
const output = fileURLToPath(new URL('dist/', source));
if (resolve(dirname(output)) !== resolve(fileURLToPath(source))) throw new Error('Unsafe SDK output path');
const existing = await lstat(output).catch(error => { if (error.code !== 'ENOENT') throw error; return null; });
if (existing?.isSymbolicLink()) throw new Error('SDK output must not be a link');
await rm(output, { recursive: true, force: true });
await mkdir(new URL('dist/', source), { recursive: true });
const bundle = await rolldown({ input: new URL('src/index.ts', source).pathname.replace(/^\/([A-Za-z]:)/, '$1'),
  external: id => {
    const external = !id.startsWith('.') && !isAbsolute(id);
    if (external) referenced.add(id.startsWith('@') ? id.split('/').slice(0, 2).join('/') : id.split('/')[0]);
    return external;
  } });
await bundle.write({ dir: new URL('dist/', source).pathname.replace(/^\/([A-Za-z]:)/, '$1'), format: 'es', entryFileNames: 'index.js', sourcemap: true });
await bundle.close();
// Keep Node execution and MCP out of the browser entry. Package their source closure
// so Worker URLs and the audited sandbox bundle are available after npm installation.
const runtime = new URL('dist/runtime/', source);
for (const directory of ['application','modules','foundation','apps/mcp-server','apps/server','public/assets']) {
  await cp(new URL(directory, root), new URL(directory, runtime), {recursive:true});
}
await copyFile(new URL('package-lock.json', root), new URL('package-lock.json', runtime));
await copyFile(new URL('package.json', root), new URL('package.json', runtime));
await copyFile(new URL('src/node.mjs', source), new URL('dist/node.js', source));
await writeFile(new URL('dist/mcp.js', source), "export { startServer } from './runtime/apps/mcp-server/main.mjs';\n");
const worker = await rolldown({input:fileURLToPath(new URL('application/code-execution/BrowserCodeWorker.js',root))});
try { await worker.write({file:fileURLToPath(new URL('dist/BrowserCodeWorker.js',source)),format:'es'}); } finally { await worker.close(); }
sdk.dependencies = {...pkg.dependencies};
sdk.exports['.'] = {types:'./dist/index.d.ts',browser:'./dist/index.js',node:'./dist/node.js',import:'./dist/index.js'};
sdk.exports['./node'] = {types:'./dist/node.d.ts',import:'./dist/node.js'};
sdk.exports['./mcp'] = {types:'./dist/mcp.d.ts',import:'./dist/mcp.js'};
await writeFile(new URL('package.json', source), JSON.stringify(sdk, null, 2) + '\n');
await copyFile(new URL('src/index.d.ts', source), new URL('dist/index.d.ts', source));
await copyFile(new URL('src/node.d.ts', source), new URL('dist/node.d.ts', source));
await copyFile(new URL('src/mcp.d.ts', source), new URL('dist/mcp.d.ts', source));
await copyFile(new URL('LICENSE', root), new URL('LICENSE', source));
console.log('Standalone SDK build complete');
