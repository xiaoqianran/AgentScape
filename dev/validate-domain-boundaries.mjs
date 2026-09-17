import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PRODUCT_ROOTS = ["apps", "application", "modules", "foundation"];
const LEGACY_ROOTS = ["src", "server", "tools", "scripts", "experiments", "ops", "studio", "observatory", "agent", "generation", "artifact", "asset", "world", "core", "tooling", "planning-ui"];

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

const productJs = PRODUCT_ROOTS.flatMap((dir) => walk(path.join(root, dir))).filter((file) => /\.[cm]?[jt]sx?$/.test(file));
const assetCore = productJs.filter((file) => {
  const name = relative(file);
  return [
    "modules/asset/registry/AssetCatalog.js",
    "modules/asset/model/AssetRef.js",
    "modules/asset/registry/AssetRegistry.js",
    "modules/asset/model/admission.js",
    "modules/asset/model/schema.js",
    "modules/asset/model/parts.js"
  ].includes(name)
    || name.startsWith("modules/asset/persistence/")
    || name.startsWith("modules/asset/loading/")
    || (name.startsWith("modules/asset/production/compiler/") && !name.startsWith("modules/asset/production/compiler/providers/"));
});
const artifactCore = productJs.filter((file) => relative(file).startsWith("modules/artifact/"));
const worldCore = productJs.filter((file) => relative(file).startsWith("modules/world/") && !relative(file).startsWith("modules/world/content/"));
const coreFiles = productJs.filter((file) => relative(file).startsWith("foundation/"));

const failures = [];
const functionalCoreFiles = productJs.filter((file) => {
  const name=relative(file);
  return name.startsWith("modules/world/spec/")
    || name.startsWith("modules/world/compiler/")
    || name.startsWith("modules/world/verification/")
    || name.startsWith("modules/generation/jobs/")
    || name.startsWith("modules/generation/providers/")
    || name === "modules/artifact/ArtifactDescriptor.js"
    || name === "modules/artifact/ArtifactContentGate.js"
    || name.startsWith("modules/asset/production/compiler/passes/")
    || ["modules/asset/model/admission.js","modules/asset/model/schema.js","modules/asset/model/parts.js","modules/agent/buildRecoveryProposals.js","application/buildTaskObservation.js"].includes(name);
});
const EXTERNAL_IO_RE = /\b(?:fetch\s*\(|localStorage\b|sessionStorage\b|indexedDB\b|process\.env\b|WebSocket\b|EventSource\b|document\.createElement\b|window\.)/;
for (const file of functionalCoreFiles) {
  const source=fs.readFileSync(file,"utf8");
  if (EXTERNAL_IO_RE.test(source)) failures.push(`Functional Core external I/O violation: ${relative(file)}`);
}

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
  /^(apps|application|modules|dev)\//
]);

assertNoImports("Module layer violation", productJs.filter(file => relative(file).startsWith('modules/')), [/^(apps|application|dev)\//]);
assertNoImports("Application layer violation", productJs.filter(file => relative(file).startsWith('application/')), [/^(apps|dev)\//]);
assertNoImports("Browser/server boundary violation", productJs.filter(file => !relative(file).startsWith('apps/server/')), [/^apps\/server\//]);

assertNoImports("Asset Core boundary violation", assetCore, [
  /^apps\/studio\//,
  /^apps\/observatory\//,
  /^modules\/agent\//,
  /^modules\/generation\//,
  /^modules\/artifact\//,
  /^modules\/world\//
]);

assertNoImports("Artifact Core boundary violation", artifactCore, [
  /^apps\/studio\//,
  /^apps\/observatory\//,
  /^modules\/agent\//,
  /^modules\/generation\//,
  /^modules\/asset\//,
  /^modules\/world\//
]);

const renderingCore = productJs.filter((file) => relative(file).startsWith("modules/rendering/"));
assertNoImports("Rendering boundary violation", renderingCore, [
  /^modules\/world\//
]);

assertNoImports("World Core boundary violation", worldCore, [
  /^apps\/studio\//,
  /^apps\/observatory\//,
  /^modules\/agent\//,
  /^modules\/generation\//,
  /^modules\/artifact\//,
  /^modules\/asset\/gateway\//,
  /^modules\/asset\/production\/compiler\/providers\//
]);

const WORLD_ASSET_IMPORTS = new Set([
  "modules/asset/model/AssetRef.js",
  "modules/asset/model/parts.js",
  "modules/asset/model/admission.js"
]);
for (const file of worldCore) {
  for (const specifier of imports(file)) {
    const target = resolveImport(file, specifier);
    if (target?.startsWith("modules/asset/") && !WORLD_ASSET_IMPORTS.has(target)) {
      failures.push(`World Core Asset boundary violation: ${relative(file)} -> ${target}`);
    }
  }
}

const agentFiles = productJs.filter((file) => relative(file).startsWith("modules/agent/"));
assertNoImports("Agent Generation deep-module boundary violation", agentFiles, [
  /^modules\/generation\/jobs\//,
  /^modules\/generation\/connector\//,
  /^modules\/generation\/providers\//,
  /^modules\/artifact\/storage\//
]);
assertNoImports("Agent World deep-module boundary violation", agentFiles, [
  /^modules\/world\/runtime\/systems\//,
  /^modules\/world\/runtime\/physics\//,
  /^modules\/world\/runtime\/navigation\/(?!NavigationBackend\.js$)/
]);
const AGENT_WORLD_INTERNAL_RE = /\bruntime\.(?:store|physics|spatial|interactions|navigation|locomotion)\b/;
for (const file of agentFiles) {
  const source=fs.readFileSync(file,"utf8");
  if (AGENT_WORLD_INTERNAL_RE.test(source)) {
    failures.push(`Agent World runtime-internal boundary violation: ${relative(file)}`);
  }
}

const agentFacingWritePacks = productJs.filter((file) => [
  'application/skills/packs/interactionSkills.js',
  'application/skills/packs/recoverySkills.js'
].includes(relative(file)));
for (const file of agentFacingWritePacks) {
  const source=fs.readFileSync(file,'utf8');
  if (AGENT_WORLD_INTERNAL_RE.test(source)) {
    failures.push(`Agent-facing World command boundary violation: ${relative(file)}`);
  }
}
const spatialSkillsFile=productJs.find((file)=>relative(file)==='application/skills/packs/spatialSkills.js');
if (spatialSkillsFile) {
  const source=fs.readFileSync(spatialSkillsFile,'utf8');
  if (AGENT_WORLD_INTERNAL_RE.test(source)) {
    failures.push('Agent-facing World query boundary violation: application/skills/packs/spatialSkills.js');
  }
}

const assetClients = productJs.filter((file) => {
  const name=relative(file);
  return !name.startsWith("modules/asset/") && !name.startsWith("apps/observatory/");
});
assertNoImports("Asset deep-module boundary violation", assetClients, [
  /^modules\/asset\/production\//,
  /^modules\/asset\/loading\//,
  /^modules\/asset\/persistence\//
]);

const productionJs = productJs.filter((file) => !relative(file).startsWith("apps/observatory/"));
assertNoImports("Observatory ownership violation", productionJs, [
  /^apps\/observatory\//
]);

const expectedOrchestrator = path.join(root, "application", "generation", "GenerationOrchestrator.js");
if (!fs.existsSync(expectedOrchestrator)) failures.push("Cross-domain generation orchestration belongs in application/generation/");

for (const file of productJs) {
  const name = relative(file);
  const source = fs.readFileSync(file, "utf8");
  if (name !== "modules/asset/AssetModule.js") {
    if (/\bnew\s+AssetRegistry\s*\(/.test(source)) failures.push(`Asset registry ownership violation: ${name} constructs AssetRegistry outside AssetModule`);
    if (/\bnew\s+AssetLoader\s*\(/.test(source)) failures.push(`Asset loader ownership violation: ${name} constructs AssetLoader outside AssetModule`);
  }
  if (name !== "modules/artifact/ArtifactModule.js") {
    if (/\bnew\s+ArtifactRegistry\s*\(/.test(source)) failures.push(`Artifact state ownership violation: ${name} constructs ArtifactRegistry outside ArtifactModule`);
    if (/\bnew\s+MemoryArtifactByteStore\s*\(/.test(source)) failures.push(`Artifact state ownership violation: ${name} constructs MemoryArtifactByteStore outside ArtifactModule`);
  }
  for (const specifier of imports(file)) {
    const target = resolveImport(file, specifier);
    if (target === "modules/asset/production/AssetProductionPipeline.js" && name !== "modules/asset/AssetModule.js") {
      failures.push(`Asset production boundary violation: ${name} imports AssetProductionPipeline outside AssetModule`);
    }
    if (target === "modules/asset/persistence/AssetManifestStore.js" && name !== "modules/asset/AssetModule.js") {
      failures.push(`Asset persistence boundary violation: ${name} imports AssetManifestStore outside AssetModule`);
    }
    if (target === "modules/artifact/storage/IndexedDbArtifactStore.js" && name !== "modules/artifact/ArtifactModule.js") {
      failures.push(`Artifact persistence boundary violation: ${name} imports IndexedDbArtifactStore outside ArtifactModule`);
    }
  }
}

if (failures.length) {
  console.error("domain architecture validation failed");
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log(`domain architecture validation passed (core ${coreFiles.length}, artifact core ${artifactCore.length}, asset core ${assetCore.length}, world core ${worldCore.length})`);
console.log("Root architecture: apps / application / modules / foundation; observatory may inspect product runtime, but product runtime must not depend on observatory.");
