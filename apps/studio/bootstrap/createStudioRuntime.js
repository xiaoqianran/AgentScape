import { createSession } from '../../../application/createSession.js';
import { AgentTools } from '../../../application/AgentTools.js';
import { createAuthoringModelResolver } from '../../../application/world-authoring/AuthoringModelResolver.js';
import { AuthoringWorldController } from '../authoring/AuthoringWorldController.js';
import { AuthoringWorldStore } from '../persistence/AuthoringWorldStore.js';
import { RuntimeDriver } from '../runtime/RuntimeDriver.js';
import { StudioEnvironmentMaterializer } from '../ui/StudioEnvironmentMaterializer.js';
import { StudioWorldSurface } from '../ui/StudioWorldSurface.js';
import { EditorController } from '../editor/EditorController.js';
import { CAPABILITY_API, LOCAL_ADAPTER_HOST } from '../config/capabilityEntry.js';
import { AssetAgentVerifier } from '../agent/AssetAgentVerifier.js';

export async function createStudioRuntime({
  ui,
  environmentDefinition,
  params,
  capabilityStatus
}) {
  const environmentMaterializer = new StudioEnvironmentMaterializer({ parent:ui.shell });
  const { world, generation, authoring, promotion } = createSession(ui.viewport, {
    environmentFactory: options => environmentMaterializer.materialize(environmentDefinition, options),
    rendererMode: params.get('renderer') || 'auto',
    rendererTiming: params.get('gpuTiming') === '1',
    generation: {
      assetInputPolicy:'approved-image',
      compilerEndpoint:capabilityStatus.assetCompile.available ? CAPABILITY_API.assetCompile : '',
      connectorEndpoint:LOCAL_ADAPTER_HOST.connector
    }
  });

  world.generationState = await generation.initialize({ pair:false });
  await world.init();

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

  const studioTools = new AgentTools(world, { profile:'builder', actor:'agent_01', source:'studio-ui' });
  if (authoringWorlds) authoringWorlds.tools = studioTools;
  const agentTools = new AgentTools(world, { profile:'builder', actor:'agent_01', source:'agent' });
  const runtimeTestTools = new AgentTools(world, { profile:'builder', actor:'agent_01', source:'runtime-test' });
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
      getSelection:()=>ui.getSelection?.() || null,
      setSelection:(selection)=>ui.setSelection?.(selection)
    }),
    onPresentationChange:(identity)=>ui.setWorldPresentation?.(identity),
    onSurfaceError:(error)=>console.error('Studio world surface cleanup failed', error)
  });

  const editor = worldSurface.editor;
  const runtimeDriver = new RuntimeDriver(world, {
    authoring,
    syncInput:(frameTime)=>worldSurface.syncInput(frameTime)
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
      worldSurface.dispose();
      runtimeDriver.dispose();
      promotion?.dispose();
      authoring?.dispose();
      world.dispose();
    }
  };
}
