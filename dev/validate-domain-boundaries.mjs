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
const AGENT_WORLD_INTERNAL_RE = /\bruntime\.(?:store|physics|spatial|interactions|navigation|locomotion|sceneGraph|affordances|repair|validator)\b/;
for (const file of agentFiles) {
  const source=fs.readFileSync(file,"utf8");
  if (AGENT_WORLD_INTERNAL_RE.test(source)) {
    failures.push(`Agent World runtime-internal boundary violation: ${relative(file)}`);
  }
}

const agentFacingWorldPacks = productJs.filter((file) => relative(file).startsWith('application/skills/packs/'));
const AGENT_SKILL_WORLD_INTERNAL_RE = /\bruntime\.(?:store|physics|spatial|interactions|navigation|locomotion|sceneGraph|affordances|repair|recovery|validator)\b/;
const WORLD_DIRECT_QUERY_RE = /\bruntime\.(?:listObjects|articulationStatus|carryStatus|findRecoveryCleanupPlan)\s*\(/;
for (const file of agentFacingWorldPacks) {
  const source=fs.readFileSync(file,'utf8');
  if (AGENT_SKILL_WORLD_INTERNAL_RE.test(source)) {
    failures.push(`Agent-facing World façade boundary violation: ${relative(file)}`);
  }
  if (WORLD_DIRECT_QUERY_RE.test(source)) {
    failures.push(`WorldQueries façade bypass: ${relative(file)}`);
  }
}

const WORLD_DIRECT_WRITE_RE = /\b(?:runtime|this\.runtime|world|this\.world)\.(?:spawn|applyObjectTransform|duplicate|remove|navigateAgent|approachAndInteract|approachAndPickup|approachAndPlace|dropHeld|markRecoveryHeld|cleanupRecoveryBlocker|applyStateTransition)\s*\(|\b(?:runtime|this\.runtime|world|this\.world)\.(?:interactions\.(?:pickup|drop|place|setArticulationAction|setHumanViewPose)|physics\.(?:beginTransform|endTransform)|affordances\.execute|repair\.repair)\s*\(/;
const worldCommandClients = productJs.filter((file) => {
  const name=relative(file);
  return name.startsWith('application/') || name.startsWith('apps/studio/');
});
for (const file of worldCommandClients) {
  const source=fs.readFileSync(file,'utf8');
  if (WORLD_DIRECT_WRITE_RE.test(source)) {
    failures.push(`WorldCommands façade bypass: ${relative(file)}`);
  }
}

const studioPresentationFiles = productJs.filter((file) => {
  const name=relative(file);
  return name.startsWith('apps/studio/react/')
    || name === 'apps/studio/ui/resources/ResourceLibrary.js';
});
const STUDIO_PRESENTATION_RUNTIME_INTERNAL_RE = /\bworld\.(?:assetModule|generation\.artifacts|generationState|physics|store|rendering)\b/;
for (const file of studioPresentationFiles) {
  const source=fs.readFileSync(file,'utf8');
  if (STUDIO_PRESENTATION_RUNTIME_INTERNAL_RE.test(source)) {
    failures.push(`Studio presentation runtime-internal boundary violation: ${relative(file)}`);
  }
}

const retiredStudioGlobalCss = path.join(root,'apps','studio','style.css');
if (fs.existsSync(retiredStudioGlobalCss)) {
  failures.push('Retired Studio global stylesheet must not return: apps/studio/style.css');
}

const studioCssFiles = walk(path.join(root,'apps','studio')).filter((file) => file.endsWith('.css'));
const studioCssOwners = [
  ['Build', /\.build-[\w-]+/, new Set(['apps/studio/react/build/BuildWorkbench.css'])],
  ['Task', /\.task-[\w-]+/, new Set(['apps/studio/ui/task/TaskPanel.css'])],
  ['Generation', /\.generation-[\w-]+/, new Set([
    'apps/studio/ui/generation/GenerationJobCenter.css',
    // Build owns the contextual visibility of the Advanced Generation console.
    'apps/studio/react/build/BuildWorkbench.css'
  ])],
  ['Resource', /\.resource-[\w-]+/, new Set(['apps/studio/ui/resources/ResourceLibrary.css'])],
  ['Runs', /\.(?:runs|run)-[\w-]+/, new Set(['apps/studio/ui/runs/RunsPanel.css'])],
  ['Inspector', /\.(?:inspect-[\w-]+|inspector\b|object-title\b)/, new Set(['apps/studio/react/inspect/ObjectInspector.css'])],
  ['Developer', /\.(?:developer|settings|dialog)-[\w-]+/, new Set(['apps/studio/ui/developer/DeveloperSettings.css'])],
  ['Debug', /\.debug-[\w-]+/, new Set(['apps/studio/debug/DebugLayers.css'])],
  ['World overlay', /\.(?:world-context\b|cabin-[\w-]+|human-[\w-]+|asset-placement-[\w-]+)/, new Set(['apps/studio/ui/WorldOverlays.css'])]
];
const STUDIO_SHELL_FEATURE_ROOT_LAYOUT_RE = /^\.panel(?:\[data-view="[^"]+"\]|:not\(\[data-view="[^"]+"\]\))(?:\.[\w-]+)*(?: >)? \.(?:build-workbench|build-advanced-shell|generation-console|task-console|resource-console|inspector|runs-console)$/;
for (const file of studioCssFiles) {
  const name=relative(file);
  const source=fs.readFileSync(file,'utf8');
  const selectors=[...source.matchAll(/(?:^|})\s*([^@{}][^{}]*?)\s*\{/gm)]
    .flatMap((match) => match[1].split(','))
    .map((selector) => selector.trim())
    .filter(Boolean);
  for (const [label,pattern,owners] of studioCssOwners) {
    const foreign=selectors.filter((selector) => pattern.test(selector));
    if (!foreign.length || owners.has(name)) continue;
    const shellFeatureRootLayoutOnly=name === 'apps/studio/ui/chrome/studio-shell.css'
      && foreign.every((selector) => STUDIO_SHELL_FEATURE_ROOT_LAYOUT_RE.test(selector));
    if (!shellFeatureRootLayoutOnly) failures.push(`Studio CSS ownership violation (${label}): ${name}`);
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
const WORLD_RUNTIME_ASSET_ALIAS_RE = /\b(?:runtime|world|this\.runtime|this\.world)(?:\?\.|\.)(?:assetRegistry|assetLoader|assetCatalog)\b/;
const WORLD_RUNTIME_REMOVED_FACADE_RE = /\b(?:runtime|world|this\.runtime|this\.world)(?:\?\.|\.)(?:captureWorldAuthority|restoreWorldAuthority|renderingDiagnostics|resize)\b/;
for (const file of productJs) {
  const source = fs.readFileSync(file, 'utf8');
  if (WORLD_RUNTIME_ASSET_ALIAS_RE.test(source)) {
    failures.push(`WorldRuntime AssetModule alias bypass: ${relative(file)}`);
  }
  if (WORLD_RUNTIME_REMOVED_FACADE_RE.test(source)) {
    failures.push(`WorldRuntime removed façade usage: ${relative(file)}`);
  }
}

const productionJs = productJs.filter((file) => !relative(file).startsWith("apps/observatory/"));
for (const file of productionJs.filter((file) => !relative(file).startsWith('application/generation/'))) {
  const source = fs.readFileSync(file, 'utf8');
  if (/\.generation\.(?:artifactRegistry|byteStore|artifactImporter|connectorArtifactClient)\b/.test(source)) {
    failures.push(`Generation Artifact façade bypass: ${relative(file)}`);
  }
}
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
