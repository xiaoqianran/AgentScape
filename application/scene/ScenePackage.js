import * as z from 'zod/v4';
import { parseSceneProject } from './SceneProject.js';
import { assetDigest, canonicalAssetJson, assertEmbeddedGLB } from '../../modules/asset/model/AssetInputContracts.js';
import { assetManifests } from '../../modules/asset/registry/manifests/index.js';
import { createAssetModule } from '../../modules/asset/AssetModule.js';
import { stylePackSchema } from '../../modules/rendering/style/StylePack.js';
import { RUNTIME_VERSION } from '../../foundation/version.js';
import { ArticulationVerifier } from '../../modules/world/verification/ArticulationVerifier.js';

const hash = z.string().regex(/^[a-f0-9]{64}$/);
const descriptor = z.object({ id: z.string().min(1).max(100), sha256: hash, bytes: z.string().max(45 * 1024 * 1024), definition: z.record(z.string(), z.unknown()) }).strict();
const schema = z.object({ schema: z.literal('agentscape.project-bundle'), schemaVersion: z.literal(1),
  project: z.unknown(), snapshot: z.unknown(),
  lock: z.object({ engine: z.enum(['1.34.2', RUNTIME_VERSION]), builtins: hash, content: hash }).strict(),
  assets: z.array(descriptor).max(32),
  style: stylePackSchema.optional()
}).strict();
const builtinHash = () => assetDigest(new TextEncoder().encode(canonicalAssetJson(assetManifests)));
const encode = bytes => { let text = ''; for (let i = 0; i < bytes.length; i += 8192) text += String.fromCharCode(...bytes.subarray(i, i + 8192)); return btoa(text); };
const decode = text => {
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(text)) throw new Error('INVALID_RESOURCE_ENCODING');
  return Uint8Array.from(atob(text), c => c.charCodeAt(0));
};
const digestContent = value => assetDigest(new TextEncoder().encode(canonicalAssetJson(value)));
const definitionOf = manifest => Object.fromEntries(['type', 'label', 'actions', 'physics', 'parts', 'surfaces', 'receptacles', 'requiredNodes', 'interactionContract', 'capabilityLevel'].filter(key => manifest[key] != null).map(key => [key, structuredClone(manifest[key])]));

/** JSON transport for scene.json, lock, runtime snapshot and embedded resources.
 * Directory/ZIP adapters can encode these same bytes without executing sources.
 */
export async function exportScenePackage(world, { name = 'Untitled World', readResource = null, style = null } = {}) {
  if (world.mutationOwner) throw new Error('SCENE_BUSY');
  const snapshot = world.serialize({ name }), assets = [];
  let total = 0;
  for (const manifest of snapshot.assets) {
    let bytes;
    if (manifest.source.kind === 'compiled') bytes = (await world.assetModule.compiledStore.get(manifest.source.key))?.bytes;
    else if (readResource) bytes = await readResource(manifest.source.url, manifest.id);
    if (!(bytes instanceof Uint8Array)) throw new Error('RESOURCE_UNAVAILABLE');
    bytes = bytes.slice(); assertEmbeddedGLB(bytes);
    total += bytes.length; if (total > 64 * 1024 * 1024) throw new Error('RESOURCE_LIMIT');
    assets.push({ id: manifest.id, sha256: await assetDigest(bytes), bytes: encode(bytes), definition: definitionOf(manifest) });
  }
  // Source URLs, historical compiler evidence and host paths never enter transport.
  snapshot.assets = [];
  const project = parseSceneProject({ schema: 'agentscape.scene-project', schemaVersion: 1, name,
    environment: { type: 'builtin', id: world.environment.id },
    ...(style ? { style: './styles/current/style.json' } : {}),
    objects: snapshot.objects.map(object => ({ id: object.id,
      asset: world.assetModule.getManifest(object.assetId).source.kind === 'builtin' ? `builtin://${object.assetId}` : `./assets/${assets.findIndex(a => a.id === object.assetId)}/model.glb`,
      level: world.assetModule.getManifest(object.assetId).capabilityLevel || 'physical',
      transform: { ...object.transform, scale: object.transform.scale[0] } })) });
  const payload = { project, snapshot, assets, ...(style ? { style: stylePackSchema.parse(style) } : {}) };
  const content = await digestContent(payload);
  return { schema: 'agentscape.project-bundle', schemaVersion: 1, ...payload,
    lock: { engine: RUNTIME_VERSION, builtins: await builtinHash(), content } };
}

/** Prepare entirely in a fresh Runtime. Failure never mutates the caller's world. */
/** @param {any} input @param {{container?: HTMLElement|null, assetModule?: any}} options */
export async function openScenePackage(input, { container = null, assetModule = null } = {}) {
  if (typeof input === 'string') {
    if (input.length > 96 * 1024 * 1024) throw new Error('DOCUMENT_LIMIT');
    input = JSON.parse(input);
  }
  const bundle = schema.parse(structuredClone(input)), project = parseSceneProject(bundle.project);
  if (bundle.lock.builtins !== await builtinHash() || bundle.lock.content !== await digestContent({ project: bundle.project, snapshot: bundle.snapshot, assets: bundle.assets, ...(bundle.style ? { style: bundle.style } : {}) })) throw new Error('PROJECT_INTEGRITY_MISMATCH');
  if (Boolean(project.style) !== Boolean(bundle.style)) throw new Error('STYLE_DEPENDENCY_MISSING');
  if (bundle.snapshot?.metadata?.stylePack && canonicalAssetJson(bundle.snapshot.metadata.stylePack) !== canonicalAssetJson(bundle.style)) throw new Error('STYLE_DEPENDENCY_MISMATCH');
  if (!Array.isArray(bundle.snapshot?.objects) || bundle.snapshot.objects.length !== project.objects.length) throw new Error('PROJECT_SNAPSHOT_MISMATCH');
  for (let index = 0; index < project.objects.length; index++) {
    const object = project.objects[index], saved = bundle.snapshot.objects[index];
    const assetIndex = bundle.assets.findIndex(asset => asset.id === saved.assetId);
    const reference = assetIndex < 0 ? `builtin://${saved.assetId}` : `./assets/${assetIndex}/model.glb`;
    if (object.id !== saved.id || object.asset !== reference || canonicalAssetJson(object.transform) !== canonicalAssetJson({ ...saved.transform, scale: saved.transform?.scale?.[0] })) throw new Error('PROJECT_SNAPSHOT_MISMATCH');
  }
  const ids = new Set(); let total = 0;
  const prepared = [];
  for (const item of bundle.assets) {
    if (ids.has(item.id) || assetManifests[item.id]?.source.kind === 'builtin') throw new Error('ASSET_ID_CONFLICT');
    ids.add(item.id);
    const bytes = decode(item.bytes); total += bytes.length;
    if (total > 64 * 1024 * 1024 || await assetDigest(bytes) !== item.sha256) throw new Error('RESOURCE_INTEGRITY_MISMATCH');
    assertEmbeddedGLB(bytes); prepared.push({ ...item, bytes });
  }
  const assets = assetModule || createAssetModule({ volatile: true, manifests: Object.fromEntries(Object.entries(assetManifests).filter(([id]) => !ids.has(id))), manifestStore: null, libraryStore: null });
  assets.configureVerification({articulationVerifier:new ArticulationVerifier({assetRegistry:assets.registry,assetLoader:assets.loader})});
  for (const item of prepared) {
    await assets.importPackageAsset(item);
  }
  const { openScene } = await import('./SceneFacade.js');
  const scene = await openScene({ container, assetModule: assets, project: { ...project, objects: [], style: undefined } });
  try { await scene.restoreSnapshot(bundle.snapshot, { prepared: true }); if (bundle.style) await scene.setStyle(bundle.style); return scene; }
  catch (error) { scene.close(); throw error; }
}

/** Validate in an isolated session, then reuse Runtime's own transactional restore. */
export async function importScenePackageInto(world, input, { applyStyle, getStyle } = {}) {
  const bundle = schema.parse(structuredClone(typeof input === 'string' ? JSON.parse(input) : input));
  const ids = new Set(bundle.assets.map(asset => asset.id));
  const assets = createAssetModule({ volatile: true, manifests: Object.fromEntries(Object.entries(assetManifests).filter(([id]) => !ids.has(id))), manifestStore: null, libraryStore: null });
  if (world.rendering?.renderer) assets.configureRenderer(world.rendering.renderer);
  let staged;
  try {
    staged = await openScenePackage(bundle, { assetModule: assets });
    if (bundle.project.environment.id !== world.environment.id) throw new Error('ENVIRONMENT_MISMATCH');
    const snapshot = staged.snapshot(), entries = [];
    if (bundle.snapshot.camera) snapshot.camera = structuredClone(bundle.snapshot.camera);
    for (const asset of bundle.assets) {
      const manifest = assets.getManifest(asset.id), stored = await assets.compiledStore.get(manifest.source.key);
      entries.push({ manifest, bytes: stored.bytes, expectedSourceHash: asset.sha256, expectedDefinition: asset.definition });
    }
    const previousStyle = getStyle?.() || null;
    return await world.assetModule.installPreparedAssets(entries, async () => {
      snapshot.assets = snapshot.assets.map(manifest => world.assetModule.getManifest(manifest.id));
      try {
        return await world.mutate('scene:import-project', async () => {
          await world.restoreSnapshot(snapshot);
          await applyStyle?.(bundle.style || null);
          return { status: 'project-imported', objects: snapshot.objects.length };
        });
      } catch (error) { await applyStyle?.(previousStyle); throw error; }
    });
  } finally { staged?.close(); assets.loader.gltfLoader.dispose?.(); }
}
