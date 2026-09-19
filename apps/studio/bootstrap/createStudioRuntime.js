import { createSession } from '../../../application/createSession.js';
import { AgentTools } from '../../../application/AgentTools.js';
import { createAuthoringModelResolver } from '../../../application/world-authoring/AuthoringModelResolver.js';
import { AuthoringWorldController } from '../authoring/AuthoringWorldController.js';
import { AuthoringWorldStore } from '../persistence/AuthoringWorldStore.js';
import { RuntimeDriver } from '../runtime/RuntimeDriver.js';
import { StudioEnvironmentMaterializer } from '../ui/StudioEnvironmentMaterializer.js';
import { StudioWorldSurface } from '../ui/StudioWorldSurface.js';
import { CAPABILITY_API, LOCAL_ADAPTER_HOST } from '../config/capabilityEntry.js';

export async function createStudioRuntime({
  ui,
  environmentDefinition,
  params,
  capabilityStatus
}) {
  const environmentMaterializer = new StudioEnvironmentMaterializer({ parent:ui.shell });
  const { world, generation, authoring } = createSession(ui.viewport, {
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
    store:new AuthoringWorldStore(),
    resolveModel:resolveAuthoringModel
  }) : null;

  const studioTools = new AgentTools(world, { profile:'builder', actor:'agent_01', source:'studio-ui' });
  const agentTools = new AgentTools(world, { profile:'builder', actor:'agent_01', source:'agent' });
  const runtimeTestTools = new AgentTools(world, { profile:'builder', actor:'agent_01', source:'runtime-test' });

  const worldSurface = new StudioWorldSurface({
    world,
    ui,
    tools:studioTools,
    environmentMaterializer,
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
      authoring?.dispose();
      world.dispose();
    }
  };
}
