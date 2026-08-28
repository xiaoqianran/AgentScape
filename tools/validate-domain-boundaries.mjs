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
    'src/assets/AssetRef.js',
    'src/assets/AssetManager.js',
    'src/assets/createAssetModule.js',
    'src/assets/publishAsset.js',
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
    || name.startsWith('src/runtime/interaction/')
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

const WORLD_ASSET_IMPORTS = new Set([
  'src/assets/AssetRef.js',
  'src/assets/parts.js'
]);
for (const file of worldCore) {
  for (const specifier of imports(file)) {
    const target = resolveImport(file, specifier);
    if (target?.startsWith('src/assets/') && !WORLD_ASSET_IMPORTS.has(target)) {
      failures.push(`World Core Asset boundary violation: ${relative(file)} -> ${target}`);
    }
  }
}

const legacyOrchestratorPath = path.join(root, 'src/generation/GenerationOrchestrator.js');
if (fs.existsSync(legacyOrchestratorPath)) {
  failures.push('Authoring ownership violation: GenerationOrchestrator must live under src/authoring/');
}

const legacyGenerationDir = path.join(root, 'src/generation');
if (fs.existsSync(legacyGenerationDir)) {
  const productionFiles = walk(legacyGenerationDir).filter((file) => file.endsWith('.js'));
  if (productionFiles.length) {
    failures.push(`Authoring ownership violation: src/generation/ must not own production modules (${productionFiles.map(relative).join(', ')})`);
  }
}

for (const file of allJs) {
  const name = relative(file);
  const source = fs.readFileSync(file, 'utf8');
  if (name === 'src/runtime/systems/InteractionSystem.js') {
    for (const field of ['articulationTasks', 'articulationResults', 'settleTasks']) {
      const directMapOwner = new RegExp(String.raw`\bthis\.${field}\s*=\s*new\s+Map\s*\(`);
      if (directMapOwner.test(source)) {
        failures.push(`Interaction lifecycle ownership violation: ${field} must be owned by an interaction task runtime`);
      }
    }
  }
  if (name !== 'src/assets/createAssetModule.js') {
    if (/new\s+AssetManager\s*\(/.test(source)) {
      failures.push(`Asset state ownership violation: ${name} constructs AssetManager outside createAssetModule`);
    }
    if (/new\s+ArtifactRegistry\s*\(/.test(source)) {
      failures.push(`Artifact state ownership violation: ${name} constructs ArtifactRegistry outside createAssetModule`);
    }
    if (/new\s+MemoryArtifactByteStore\s*\(/.test(source)) {
      failures.push(`Artifact state ownership violation: ${name} constructs MemoryArtifactByteStore outside createAssetModule`);
    }
    for (const specifier of imports(file)) {
      if (resolveImport(file, specifier) === 'src/assets/publishAsset.js') {
        failures.push(`Asset publication boundary violation: ${name} imports publication internals directly`);
      }
    }
  }
}

if (failures.length) {
  console.error('domain architecture validation failed');
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log(`domain architecture validation passed (asset core ${assetCore.length} files, world core ${worldCore.length} files)`);
console.log('AssetCatalog is the single Asset read facade; generation orchestration and Job Center live under src/authoring/.');
