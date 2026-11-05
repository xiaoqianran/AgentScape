import { rolldown } from 'rolldown';
import { readFile, writeFile, mkdir, copyFile, rm, lstat } from 'node:fs/promises';
import { isAbsolute, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = new URL('../', import.meta.url);
const source = new URL('sdk/typescript/', root);
const pkg = JSON.parse(await readFile(new URL('package.json', root), 'utf8'));
const sdk = JSON.parse(await readFile(new URL('package.json', source), 'utf8'));
sdk.version = pkg.version;
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
sdk.dependencies = Object.fromEntries(Object.entries(pkg.dependencies).filter(([name]) => referenced.has(name)));
await writeFile(new URL('package.json', source), JSON.stringify(sdk, null, 2) + '\n');
await copyFile(new URL('src/index.d.ts', source), new URL('dist/index.d.ts', source));
await copyFile(new URL('LICENSE', root), new URL('LICENSE', source));
console.log('Standalone SDK build complete');
