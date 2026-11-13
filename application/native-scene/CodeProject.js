import * as THREE from 'three';
import * as z from 'zod/v4';
import { attachNativeScene } from './NativeSceneHost.js';
import { exportRuntimeState, restoreRuntimeState } from '../scene/ScenePackage.js';
import { assetDigest, canonicalAssetJson } from '../../modules/asset/model/AssetInputContracts.js';
import { projectJson } from '../../modules/world/runtime/ProjectCapabilities.js';

const fail = code => Object.assign(new Error(code), { code });
const schema = z.object({
  schema: z.literal('agentscape.code-project'), schemaVersion: z.literal(1),
  id: z.string().regex(/^[A-Za-z][A-Za-z0-9_-]*$/), name: z.string().min(1),
  source: z.string().min(1), resources: z.record(z.string(), z.object({ mime: z.string(), base64: z.string() }).strict()).default({}),
  state: z.unknown().optional(), runtime: z.unknown().optional(),
  integrity: z.string().regex(/^[a-f0-9]{64}$/).optional(),
}).strict();
const digest = value => assetDigest(new TextEncoder().encode(canonicalAssetJson(value)));

/** Parse and inspect without running any source. Budgets are host configuration. */
export async function parseCodeProject(input, { maxBytes = 64 * 1024 * 1024 } = {}) {
  const text = typeof input === 'string' ? input : JSON.stringify(input);
  if (new TextEncoder().encode(text).byteLength > maxBytes) throw fail('CODE_PROJECT_LIMIT');
  const project = schema.parse(typeof input === 'string' ? JSON.parse(text) : structuredClone(input));
  const { integrity, ...payload } = project;
  if (integrity && await digest(payload) !== integrity) throw fail('CODE_PROJECT_INTEGRITY_MISMATCH');
  if ('state' in project) projectJson(project.state);
  return project;
}

async function importSource(source) {
  // A real ES module, not the serializable asset Worker. The caller has chosen
  // trusted project execution; custom shaders/functions/closures remain alive.
  if (typeof window === 'undefined') return import(/* @vite-ignore */ `data:text/javascript;charset=utf-8,${encodeURIComponent(source)}#${crypto.randomUUID()}`);
  const url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
  try { return await import(/* @vite-ignore */ url); } finally { URL.revokeObjectURL(url); }
}

/** Load a bundled ESM project exporting createProject(context). No paid provider. */
export async function openCodeProject({ project: input, container = null, authorized = false,
  autoStart = true, maxBytes, assetBaseUrl, assetModule = null, loadModule = importSource } = {}) {
  if (authorized !== true) throw fail('CODE_EXECUTION_AUTHORIZATION_REQUIRED');
  const project = await parseCodeProject(input, { maxBytes });
  const controller = new AbortController(), urls = new Map();
  let instance, session, frameId, closed = false, capturing = false, lastTime = null;
  const mount = container && document.createElement('div');
  if (mount) mount.style.cssText = 'width:100%;height:100%';
  const resource = name => {
    if (urls.has(name)) return urls.get(name);
    const item = project.resources[name];
    if (!item) throw fail('PROJECT_RESOURCE_NOT_FOUND');
    if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(item.base64)) throw fail('INVALID_RESOURCE_ENCODING');
    const bytes = Uint8Array.from(atob(item.base64), char => char.charCodeAt(0));
    const url = URL.createObjectURL(new Blob([bytes], { type: item.mime })); urls.set(name, url); return url;
  };
  const release = () => { for (const url of urls.values()) URL.revokeObjectURL(url); urls.clear(); mount?.remove(); };
  try {
    const module = await loadModule(project.source);
    if (typeof module.createProject !== 'function') throw fail('CODE_PROJECT_FACTORY_REQUIRED');
    instance = await module.createProject({ THREE, container: mount, state: project.state === undefined ? undefined : projectJson(project.state), resource, signal: controller.signal });
    if (!instance || typeof instance !== 'object') throw fail('CODE_PROJECT_INSTANCE_INVALID');
    if (instance.update != null && typeof instance.update !== 'function') throw fail('CODE_PROJECT_UPDATE_INVALID');
    session = await attachNativeScene({ scene: instance.scene, camera: instance.camera, renderer: instance.renderer,
      environmentId: `code-project:${project.id}`, name: project.name,
      colliders: instance.colliders, navigationRoot: instance.navigationRoot, autoStart: false, assetBaseUrl, assetModule });
    if (project.runtime) await restoreRuntimeState(session.world, project.runtime);
    await instance.setup?.({ scene: session.scene, world: session.world, signal: controller.signal });
    if (project.state !== undefined) await instance.restore?.(projectJson(project.state));
    const baseFrame = session.scene.frame;
    const frame = timestamp => {
      if (closed) throw fail('SCENE_CLOSED');
      const dt = lastTime === null ? 0 : Math.max(0, (timestamp - lastTime) / 1000); lastTime = timestamp;
      if (capturing) return;
      instance.update?.({ timestamp, dt }); baseFrame(timestamp);
      if (instance.render) instance.render({ timestamp, dt });
      else instance.renderer.render(instance.scene, instance.camera);
    };
    const tick = timestamp => {
      if (closed) return;
      try { frame(timestamp); frameId = requestAnimationFrame(tick); }
      catch (error) { session.world.events.emit('project.frame.failed', { message: error.message }); }
    };
    const save = () => session.scene.captureProjectState(async () => {
      if (closed) throw fail('SCENE_CLOSED');
      capturing = true;
      try {
        const state = projectJson(await instance.serialize?.() ?? null);
        const runtime = await exportRuntimeState(session.world, { name: project.name });
        const payload = { schema: project.schema, schemaVersion: 1, id: project.id, name: project.name,
          source: project.source, resources: project.resources, state, runtime };
        const value = { ...payload, integrity: await digest(payload) };
        return { schema: 'agentscape.scene-result', schemaVersion: 1, operation: 'save', status: 'succeeded',
          verification: { status: 'not-requested', evidence: null }, diagnostics: [], value };
      } finally { capturing = false; }
    });
    const close = () => {
      if (closed) return;
      session.close(); // Reject while a Scene job is still running.
      closed = true; controller.abort(); if (frameId != null) cancelAnimationFrame(frameId);
      try { instance.dispose?.(); } finally { release(); }
    };
    Object.assign(session.scene, { frame, save, close,
      capabilities: Object.freeze({ ...session.scene.capabilities, codeProject: true, nativeProjectSave: true }) });
    if (mount) container.appendChild(mount);
    if (autoStart && typeof requestAnimationFrame === 'function') frameId = requestAnimationFrame(tick);
    return { ...session, frame, save, close };
  } catch (error) {
    controller.abort();
    try { session?.close(); } finally { try { instance?.dispose?.(); } finally { release(); } }
    throw error;
  }
}
