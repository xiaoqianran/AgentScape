import * as THREE from 'three';
import * as z from 'zod/v4';
import { nativeEditableSnapshotSchema } from '../scene/NativeEditableContracts.js';
import { attachNativeScene } from './NativeSceneHost.js';
import { exportRuntimeState, restoreRuntimeState } from '../scene/ScenePackage.js';
import { assetDigest, canonicalAssetJson } from '../../modules/asset/model/AssetInputContracts.js';
import { projectJson } from '../../modules/world/runtime/ProjectCapabilities.js';
import { compileCodeProjectModules, validateCodeFiles } from './CodeProjectModules.js';

const fail = code => Object.assign(new Error(code), { code });
const schema = z.object({
  schema: z.literal('agentscape.code-project'), schemaVersion: z.literal(1),
  id: z.string().regex(/^[A-Za-z][A-Za-z0-9_-]*$/), name: z.string().min(1),
  source: z.string().min(1), entry:z.string().optional(), files:z.record(z.string(),z.string()).optional(),
  resources: z.record(z.string(), z.object({ mime: z.string(), base64: z.string() }).strict()).default({}),
  state: z.unknown().optional(), runtime: z.unknown().optional(),
  edits:nativeEditableSnapshotSchema.optional(),
  machines: z.object({schema:z.literal('agentscape.project-machine-state'),schemaVersion:z.literal(1),
    entities:z.record(z.string(),z.record(z.string(),z.unknown()))}).strict().optional(),
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
  if (project.machines) projectJson(project.machines);
  validateCodeFiles(project);
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
  let instance, session, projectModule, frameId, closed = false, capturing = false, lastTime = null;
  let lastWallTime=null,paused=false,wasSimulationRunning=false,elapsedSeconds=0,frames=0;
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
  const release = () => {
    try { projectModule?.releaseProjectModules?.(); }
    finally { for (const url of urls.values()) URL.revokeObjectURL(url); urls.clear(); mount?.remove(); }
  };
  try {
    projectModule = await loadModule(await compileCodeProjectModules(project));
    if (typeof projectModule.createProject !== 'function') throw fail('CODE_PROJECT_FACTORY_REQUIRED');
    instance = await projectModule.createProject({ THREE, container: mount, state: project.state === undefined ? undefined : projectJson(project.state), resource, signal: controller.signal });
    if (!instance || typeof instance !== 'object') throw fail('CODE_PROJECT_INSTANCE_INVALID');
    if (instance.update != null && typeof instance.update !== 'function') throw fail('CODE_PROJECT_UPDATE_INVALID');
    session = await attachNativeScene({ scene: instance.scene, camera: instance.camera, renderer: instance.renderer,
      environmentId: `code-project:${project.id}`, name: project.name,
      colliders: instance.colliders, navigationRoot: instance.navigationRoot, autoStart: false, assetBaseUrl, assetModule });
    if (project.runtime) await restoreRuntimeState(session.world, project.runtime);
    await instance.setup?.({ scene: session.scene, world: session.world, signal: controller.signal });
    if (project.state !== undefined) await instance.restore?.(projectJson(project.state));
    if (project.machines) session.world.projectCapabilities.restoreStateMachines(project.machines);
    if (project.edits) session.scene.restoreNativeEdits(project.edits);
    const baseFrame = session.scene.frame;
    // Redraw without advancing animation, physics or lastTime.
    const renderCurrent = (timestamp=lastTime??0,dt=0) => {
      if(closed)throw fail('SCENE_CLOSED');
      if(instance.render)instance.render({timestamp,dt});
      else instance.renderer.render(instance.scene,instance.camera);
    };
    const advance=(timestamp,dt,manual=false)=>{
      lastTime=timestamp;
      instance.update?.({timestamp,dt});
      if(manual){
        const result=session.scene.step();
        if(result?.skipped)throw fail('PROJECT_STEP_SKIPPED');
      }else baseFrame(timestamp);
      elapsedSeconds+=dt;frames++;
    };
    const frame = timestamp => {
      if (closed) throw fail('SCENE_CLOSED');
      if(!Number.isFinite(timestamp))throw fail('PROJECT_FRAME_TIME_INVALID');
      if(capturing||paused){lastWallTime=null;return;}
      const dt=lastWallTime===null?0:Math.max(0,(timestamp-lastWallTime)/1000);
      lastWallTime=timestamp;
      const logicalTime=lastTime===null?timestamp:lastTime+dt*1000;
      advance(logicalTime,dt);
      renderCurrent(logicalTime,dt);
    };
    const playbackStatus=()=>({
      paused,elapsedSeconds,frames,
      simulation:{running:session.world.simulation.running,tick:session.world.simulation.tick,
        time:session.world.simulation.time,fixedDt:session.world.simulation.fixedDt}
    });
    const playback={
      status:playbackStatus,
      async control({command='status',steps=1}={}){
        if(closed)throw fail('SCENE_CLOSED');
        if(command==='status')return playbackStatus();
        if(capturing)throw fail('PROJECT_BUSY');
        if(!['pause','resume','step'].includes(command)||!Number.isSafeInteger(steps)||steps<1||steps>120)
          throw fail('PROJECT_PLAYBACK_INVALID');
        // Resume must remain possible even if an external UI has started a job
        // while paused. Pause/step require idle Scene state.
        if(command==='resume'){
          if(paused){
            paused=false;lastWallTime=null;
            if(wasSimulationRunning)session.world.simulation.play();
          }
          return playbackStatus();
        }
        return session.scene.captureProjectState(()=>{
          if(command==='pause'){
            if(!paused){
              wasSimulationRunning=session.world.simulation.running;
              session.world.simulation.pause();
              paused=true;lastWallTime=null;
            }
          }else{
            if(!paused)throw fail('PROJECT_PLAYBACK_PAUSE_REQUIRED');
            const dt=session.world.simulation.fixedDt;
            for(let i=0;i<steps;i++)advance((lastTime??0)+dt*1000,dt,true);
            renderCurrent();
          }
          return playbackStatus();
        });
      }
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
        const revision=session.scene.observe().revision;
        const state = projectJson(await instance.serialize?.() ?? null);
        const machines = session.world.projectCapabilities.exportStateMachines();
        const runtime = await exportRuntimeState(session.world, { name: project.name });
        const edits = session.scene.exportNativeEdits();
        const payload = { schema: project.schema, schemaVersion: 1, id: project.id, name: project.name,
          source: project.source, ...(project.entry ? { entry:project.entry, files:project.files || {} } : {}),
          resources: project.resources, state, ...(machines ? {machines} : {}), runtime,
          ...(edits ? {edits} : {}) };
        const value = { ...payload, integrity: await digest(payload) };
        if(session.scene.observe().revision!==revision)throw fail('SCENE_REVISION_CHANGED');
        return { schema: 'agentscape.scene-result', schemaVersion: 1, operation: 'save', status: 'succeeded', revision,
          verification: { status: 'not-requested', evidence: null }, diagnostics: [], value };
      } finally { capturing = false; lastWallTime=null; }
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
    return { ...session, frame, renderCurrent, playback, save, close };
  } catch (error) {
    controller.abort();
    try { session?.close(); } finally { try { instance?.dispose?.(); } finally { release(); } }
    throw error;
  }
}
