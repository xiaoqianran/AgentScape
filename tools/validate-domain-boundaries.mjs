import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = path.join(root, 'src');

const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
  const target = path.join(dir, entry.name);
  return entry.isDirectory() ? walk(target) : [target];
});

const relative = (file) => path.relative(root, file).replaceAll(path.sep, '/');
const imports = (file) => {
  const source = fs.readFileSync(file, 'utf8');
  return [...source.matchAll(/(?:import\s+(?:[^'";]+?\s+from\s+)?|import\()\s*['"]([^'"]+)['"]/g)]
    .map((match) => match[1]);
};

const resolveImport = (file, specifier) => {
  if (!specifier.startsWith('.')) return null;
  return relative(path.resolve(path.dirname(file), specifier));
};

const allJs = walk(src).filter((file) => file.endsWith('.js'));
const assetCore = allJs.filter((file) => {
  const name = relative(file);
  return [
    'src/assets/AssetCatalog.js',
    'src/assets/admission.js',
    'src/assets/schema.js',
    'src/assets/parts.js'
  ].includes(name)
    || name.startsWith('src/assets/storage/')
    || (name.startsWith('src/compiler/') && !name.startsWith('src/compiler/providers/'));
});
const worldCore = allJs.filter((file) => {
  const name = relative(file);
  return name === 'src/runtime/WorldRuntime.js'
    || /^src\/pipeline\/World[^/]*\.js$/.test(name)
    || name.startsWith('src/runtime/systems/')
    || name.startsWith('src/runtime/physics/')
    || name.startsWith('src/runtime/graph/')
    || name.startsWith('src/runtime/behavior/')
    || /^src\/validation\/World[^/]*\.js$/.test(name);
});

const failures = [];
const assertNoImports = (label, files, forbidden) => {
  for (const file of files) {
    for (const specifier of imports(file)) {
      const target = resolveImport(file, specifier);
      if (!target) continue;
      if (forbidden.some((rule) => rule.test(target))) {
        failures.push(`${label}: ${relative(file)} -> ${target}`);
      }
    }
  }
};

assertNoImports('Asset Core boundary violation', assetCore, [
  /^src\/generation\//,
  /^src\/connector\//,
  /^src\/providers\//,
  /^src\/authoring\//,
  /^src\/pipeline\/World/,
  /^src\/runtime\/WorldRuntime\.js$/
]);

assertNoImports('World Core boundary violation', worldCore, [
  /^src\/generation\//,
  /^src\/connector\//,
  /^src\/providers\//,
  /^src\/authoring\//,
  /^src\/assets\/library\//,
  /^src\/assets\/gateway\//,
  /^src\/compiler\/providers\//
]);

if (failures.length) {
  console.error('domain architecture validation failed');
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log(`domain architecture validation passed (asset core ${assetCore.length} files, world core ${worldCore.length} files)`);
console.log('compatibility shell intentionally excluded: src/assets/library/AssetLibrary.js; authoring lives under src/authoring/.');
