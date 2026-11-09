import { createSession } from '../../../application/createSession.js';
import { SceneAgentTools } from '../../../application/scene/SceneAgentTools.js';
import { createAuthoringModelResolver } from '../../../application/world-authoring/AuthoringModelResolver.js';
import { AuthoringWorldController } from '../authoring/AuthoringWorldController.js';
import { AuthoringWorldStore } from '../persistence/AuthoringWorldStore.js';
import { RuntimeDriver } from '../runtime/RuntimeDriver.js';
import { StudioEnvironmentMaterializer } from '../ui/StudioEnvironmentMaterializer.js';
import { StudioWorldSurface } from '../ui/StudioWorldSurface.js';
import { EditorController } from '../editor/EditorController.js';
import { CAPABILITY_API, LOCAL_ADAPTER_HOST } from '../config/capabilityEntry.js';
import { AssetAgentVerifier } from '../agent/AssetAgentVerifier.js';
import { SCENE_LEGACY_SKILLS } from '../../../application/scene/SceneFacade.js';
import { StudioLiveBridgeClient, defaultAutoMcpEnabled } from '../bridge/StudioLiveBridgeClient.js';

export async function createStudioRuntime({
  ui,
  environmentDefinition,
  params,
  capabilityStatus
}) {
  const environmentMaterializer = new StudioEnvironmentMaterializer({ parent:ui.shell });
  const requestedRenderScale = Number(params.get('renderScale') ?? 1);
  const rendererPixelRatioScale = Number.isFinite(requestedRenderScale) && requestedRenderScale >= 0.5 && requestedRenderScale <= 1
    ? requestedRenderScale : 1;
  const { world, generation, authoring, promotion, scene } = createSession(ui.viewport, {
    environmentFactory: options => environmentMaterializer.materialize(environmentDefinition, options),
    rendererMode: params.get('renderer') || environmentDefinition.rendererMode || 'auto',
    rendererTiming: params.get('gpuTiming') === '1',
    rendererPixelRatioScale,
    generation: {
      assetInputPolicy:'approved-image',
      compilerEndpoint:capabilityStatus.assetCompile.available ? CAPABILITY_API.assetCompile : '',
      connectorEndpoint:LOCAL_ADAPTER_HOST.connector
    }
  });

  world.generationState = await generation.initialize({ pair:false });
  await world.init();
  const selectedPort = Number(params.get('mcpPort'));
  const bridgePort = Number.isInteger(selectedPort) && selectedPort>=1 && selectedPort<=65535 ? selectedPort : 39015;
  const liveBridge = new StudioLiveBridgeClient({world,scene,serverUrl:'http://127.0.0.1:'+bridgePort});
  ui.attachLiveBridge?.(liveBridge);

  const resolveAuthoringModel = authoring ? createAuthoringModelResolver({
    assetLoader:world.assetModule.loader,
    gltfLoader:{ loadScene:(uri)=>world.assetModule.loader.loadGLB(uri) }
  }) : null;

  const authoringWorlds = authoring ? new AuthoringWorldController({
    authoring,
    promotion,
    store:new AuthoringWorldStore(),
    resolveModel:resolveAuthoringModel
  }) : null;

  const studioTools = new SceneAgentTools(world, scene, { profile:'builder', actor:'agent_01', source:'studio-ui' });
  if (authoringWorlds) authoringWorlds.tools = studioTools;
  const agentTools = new SceneAgentTools(world, scene, { profile:'builder', actor:'agent_01', source:'agent' });
  const runtimeTestTools = new SceneAgentTools(world, scene, { profile:'builder', actor:'agent_01', source:'runtime-test' });

  if (promotion) {
    const verifier = new AssetAgentVerifier({ world, tools:runtimeTestTools });
    promotion.verifyBehavior = async entry => {
      const manifest = world.assetModule.getManifest(entry.assetId);
      if (manifest.actions.includes('pickup')) return verifier.run({ targetId:entry.entityId });
      const part = Object.entries(manifest.parts || {}).find(([, value]) => value.actions?.includes('open'));
      if (part) {
        const result = await runtimeTestTools.call('approachAndInteract', { actorId:'agent_01', targetId:entry.entityId, action:'open', partName:part[0] });
        return { status:result.status === 'action-completed' && result.targetReached && result.settled ? 'verified' : 'failed', result };
      }
      return { status:'unsupported', reason:'该交互类型尚无自动行为验证器' };
    };
  }

  const worldSurface = new StudioWorldSurface({
    world,
    ui,
    tools:studioTools,
    environmentMaterializer,
    createEditor:(runtime)=>new EditorController(runtime,{
      getAuthoringRoot:()=>authoring?.scene || null,
      getSelection:()=>ui.getSelection?.() || null,
      setSelection:(selection)=>ui.setSelection?.(selection)
    }),
    onPresentationChange:(identity)=>ui.setWorldPresentation?.(identity),
    onSurfaceError:(error)=>console.error('Studio world surface cleanup failed', error)
  });

  if (defaultAutoMcpEnabled()) liveBridge.setAutoEnabled(true);

  const editor = worldSurface.editor;
  editor.setInteractionMode(ui.getInteractionMode?.() || 'explore');
  const stopInteractionMode=ui.subscribeInteractionMode?.(mode=>editor.setInteractionMode(mode));
  const runtimeDriver = new RuntimeDriver(world, {
    authoring,
    syncInput:(frameTime)=>worldSurface.syncInput(frameTime),
    shouldRender:()=>ui.isWorldVisible?.() ?? true
  }).start();

  return {
    world,
    authoringWorlds,
    studioTools,
    agentTools,
    runtimeTestTools,
    environmentMaterializer,
    worldSurface,
    editor,
    dispose() {
      stopInteractionMode?.();
      liveBridge.dispose();
      worldSurface.dispose();
      runtimeDriver.dispose();
      promotion?.dispose();
      authoring?.dispose();
      world.dispose();
    }
  };
}
