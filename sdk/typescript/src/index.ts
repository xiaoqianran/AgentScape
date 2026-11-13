import { openScene } from '../../../application/scene/SceneFacade.js';
import { openScenePackage } from '../../../application/scene/ScenePackage.js';
import { createBrowserCodeExecutor } from '../../../application/code-execution/BrowserCodeExecutor.js';
import { attachNativeScene } from '../../../application/native-scene/NativeSceneHost.js';
import { openCodeProject } from '../../../application/native-scene/CodeProject.js';
export { openCodeProject, parseCodeProject } from '../../../application/native-scene/CodeProject.js';
export { attachNativeScene };
export { observeNativeRenderer, listNativeScenes, subscribeNativeScenes } from '../../../application/native-scene/NativeRenderDiscovery.js';
export { parseSceneProject } from '../../../application/scene/SceneProject.js';
export { recipeSchema, assetPackageSchema } from '../../../modules/asset/model/AssetInputContracts.js';
export { stylePackSchema, officialStylePacks } from '../../../modules/rendering/style/StylePack.js';
export { WorldStorage, blobChunks } from '../../../application/scene/WorldStorage.js';
export { WorldDirectory } from '../../../application/scene/WorldDirectory.js';
export { createNativeOverlayCheckpoint, openNativeOverlayCheckpoint, MemoryNativeOverlayHeadStore, IndexedDBNativeOverlayHeadStore } from '../../../application/native-scene/NativeOverlayCheckpoint.js';

export const AgentScape = {
  attach: attachNativeScene,
  openProject: openCodeProject,
  async open({ canvas, project, bundle, environment = 'monument-hall', autoStart = true, codeExecution, codeExecutor = null, codeGLTFLoader, assetModule = null }: {
    canvas?: string | HTMLElement; project?: unknown; bundle?: unknown; environment?: string; autoStart?: boolean;
    codeExecution?: {mode?:string;authorized?:boolean;wallTimeoutMs?:number}; codeExecutor?: any; codeGLTFLoader?: any; assetModule?: any;
  } = {}) {
    if (bundle && project) throw Object.assign(new Error('Use project or bundle'), { code: 'INVALID_OPTIONS' });
    const container = typeof canvas === 'string' ? globalThis.document?.querySelector<HTMLElement>(canvas) : canvas;
    if (canvas && !container) throw Object.assign(new Error('Canvas container not found'), { code: 'INVALID_CANVAS' });
    const definition = project || { schema: 'agentscape.scene-project', schemaVersion: 1, name: 'My world',
      environment: { type: 'builtin', id: environment }, objects: [] };
    const executor = codeExecutor || createBrowserCodeExecutor(codeExecution);
    let scene;
    try { scene = bundle ? await openScenePackage(bundle, { container, codeExecutor:executor, codeGLTFLoader, assetModule }) : await openScene({ project: definition, container, codeExecutor:executor, codeGLTFLoader, assetModule }); }
    catch(error) { executor?.close(); throw error; }
    let frameId: number | undefined;
    if (container && autoStart) {
      const frame = (timestamp: number) => { scene.frame(timestamp); frameId = requestAnimationFrame(frame); };
      frameId = requestAnimationFrame(frame);
    }
    const close = scene.close.bind(scene);
    return { ...scene, close() { close(); if (frameId != null) cancelAnimationFrame(frameId); } };
  }
};
