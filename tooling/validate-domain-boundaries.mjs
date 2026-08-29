import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PRODUCT_ROOTS = ["studio", "observatory", "agent", "generation", "asset", "world", "core"];
const LEGACY_ROOTS = ["src", "server", "tools", "scripts", "experiments", "ops"];

const walk = (dir) => {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(target) : [target];
  });
};

const relative = (file) => path.relative(root, file).replaceAll(path.sep, "/");
const imports = (file) => {
  const source = fs.readFileSync(file, "utf8");
  return [...source.matchAll(/(?:import\s+(?:[^'";]+?\s+from\s+)?|import\()\s*['"]([^'"]+)['"]/g)]
    .map((match) => match[1]);
};
const resolveImport = (file, specifier) => {
  if (!specifier.startsWith(".")) return null;
  return relative(path.resolve(path.dirname(file), specifier));
};

const productJs = PRODUCT_ROOTS.flatMap((dir) => walk(path.join(root, dir))).filter((file) => file.endsWith(".js"));
const assetCore = productJs.filter((file) => {
  const name = relative(file);
  return [
    "asset/AssetCatalog.js",
    "asset/AssetRef.js",
    "asset/AssetManager.js",
    "asset/admission.js",
    "asset/schema.js",
    "asset/parts.js",
  "asset/admission.js"
  ].includes(name)
    || name.startsWith("asset/storage/")
    || (name.startsWith("asset/compiler/") && !name.startsWith("asset/compiler/providers/"));
});
const worldCore = productJs.filter((file) => relative(file).startsWith("world/") && !relative(file).startsWith("world/content/"));
const coreFiles = productJs.filter((file) => relative(file).startsWith("core/"));

const failures = [];
for (const legacy of LEGACY_ROOTS) {
  if (fs.existsSync(path.join(root, legacy))) failures.push(`Legacy root directory must not return: ${legacy}/`);
}

const assertNoImports = (label, files, forbidden) => {
  for (const file of files) {
    for (const specifier of imports(file)) {
      const target = resolveImport(file, specifier);
      if (!target) continue;
      if (forbidden.some((rule) => rule.test(target))) failures.push(`${label}: ${relative(file)} -> ${target}`);
    }
  }
};

assertNoImports("Core boundary violation", coreFiles, [
  /^(studio|observatory|agent|generation|asset|world)\//
]);

assertNoImports("Asset Core boundary violation", assetCore, [
  /^studio\//,
  /^observatory\//,
  /^agent\//,
  /^generation\//,
  /^world\//
]);

assertNoImports("World Core boundary violation", worldCore, [
  /^studio\//,
  /^observatory\//,
  /^agent\//,
  /^generation\//,
  /^asset\/gateway\//,
  /^asset\/compiler\/providers\//
]);

const WORLD_ASSET_IMPORTS = new Set([
  "asset/AssetRef.js",
  "asset/parts.js",
  "asset/admission.js"
]);
for (const file of worldCore) {
  for (const specifier of imports(file)) {
    const target = resolveImport(file, specifier);
    if (target?.startsWith("asset/") && !WORLD_ASSET_IMPORTS.has(target)) {
      failures.push(`World Core Asset boundary violation: ${relative(file)} -> ${target}`);
    }
  }
}

const productionJs = productJs.filter((file) => !relative(file).startsWith("observatory/"));
assertNoImports("Observatory ownership violation", productionJs, [
  /^observatory\//
]);

const expectedOrchestrator = path.join(root, "generation", "orchestration", "GenerationOrchestrator.js");
if (!fs.existsSync(expectedOrchestrator)) failures.push("Generation ownership violation: GenerationOrchestrator must live under generation/orchestration/");

for (const file of productJs) {
  const name = relative(file);
  const source = fs.readFileSync(file, "utf8");
  if (name !== "generation/orchestration/createAssetModule.js") {
    if (/\bnew\s+AssetManager\s*\(/.test(source)) failures.push(`Asset state ownership violation: ${name} constructs AssetManager outside createAssetModule`);
    if (/\bnew\s+ArtifactRegistry\s*\(/.test(source)) failures.push(`Artifact state ownership violation: ${name} constructs ArtifactRegistry outside createAssetModule`);
    if (/\bnew\s+MemoryArtifactByteStore\s*\(/.test(source)) failures.push(`Artifact state ownership violation: ${name} constructs MemoryArtifactByteStore outside createAssetModule`);
    for (const specifier of imports(file)) {
      if (resolveImport(file, specifier) === "generation/orchestration/publishAsset.js") {
        failures.push(`Asset publication boundary violation: ${name} imports publication internals directly`);
      }
    }
  }
}

if (failures.length) {
  console.error("domain architecture validation failed");
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log(`domain architecture validation passed (core ${coreFiles.length}, asset core ${assetCore.length}, world core ${worldCore.length})`);
console.log("Root architecture: studio / observatory / agent / generation / asset / world / core; observatory may inspect product runtime, but product runtime must not depend on observatory.");
