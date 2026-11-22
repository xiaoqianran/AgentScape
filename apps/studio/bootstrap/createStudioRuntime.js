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
import { StudioCodeProjects } from '../code-project/StudioCodeProjects.js';
import { activateCodeProjectView } from './activateCodeProjectView.js';
import { createStudioStartupScope } from './createStudioStartupScope.js';

export async function createStudioRuntime({
  ui,
  environmentDefinition,
  params,
  capabilityStatus,
  projectExecutionPolicy = null,
  metrics = null
}) {
  const environmentMaterializer = new StudioEnvironmentMaterializer({ parent:ui.shell });
  const requestedRenderScale = Number(params.get('renderScale') ?? (environmentDefinition.id === 'suzhou-garden' ? 0.75 : 1));
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

  const scope = createStudioStartupScope();
  scope.add(() => world.dispose());
  scope.add(() => authoring?.dispose());
  scope.add(() => promotion?.dispose());
  try {
    metrics?.mark('session-created');
    const stopStartupPhases = scope.add(world.events.on('runtime.init.phase',({stage})=>metrics?.mark(stage)));
    const stopFirstFrame = scope.add(world.events.on('renderer.first-frame',()=>{ metrics?.mark('first-frame'); stopFirstFrame?.(); }));
    world.generationState = await generation.initialize({ pair:false });
    metrics?.mark('generation-ready');
    await world.init();
    metrics?.mark('world-initialized');
    const selectedPort = Number(params.get('mcpPort'));
    const bridgePort = Number.isInteger(selectedPort) && selectedPort>=1 && selectedPort<=65535 ? selectedPort : 39015;
    const liveBridge = scope.add(new StudioLiveBridgeClient({world,scene,serverUrl:'http://127.0.0.1:'+bridgePort}));
    scope.add(() => ui.attachLiveBridge?.(null));
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

    const worldSurface = scope.add(new StudioWorldSurface({
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
    }));

    if (defaultAutoMcpEnabled()) liveBridge.setAutoEnabled(true);

    const editor = worldSurface.editor;
    const initialMode = ui.getInteractionMode?.() || 'explore';
    editor.setInteractionMode(initialMode);
    worldSurface.applyInteractionMode(initialMode);
    const stopInteractionMode=scope.add(ui.subscribeInteractionMode?.((mode)=>{
      editor.setInteractionMode(mode);
      worldSurface.applyInteractionMode(mode);
    }));
    const runtimeDriver = scope.add(new RuntimeDriver(world, {
      authoring,
      syncInput:(frameTime)=>worldSurface.syncInput(frameTime),
      shouldRender:()=>ui.isWorldVisible?.() ?? true
    }));
    runtimeDriver.start();

    const projectHost = document.createElement('div');
    projectHost.className = 'studio-code-project-viewport';
    projectHost.hidden = true;
    scope.add(() => projectHost.remove());
    ui.viewport.appendChild(projectHost);
    const codeProjects = scope.add(new StudioCodeProjects({
      container:projectHost, baseScene:scene, baseWorld:world, executionPolicy:projectExecutionPolicy,
      onShow:inspect=>{ ui.setPage('world'); if (inspect || ui.panel?.dataset.view !== 'task') ui.setView('inspect'); },
      onActivate:session=>activateCodeProjectView({
        session, projectHost, viewport:ui.viewport, runtimeDriver, liveBridge,
        baseScene:scene, baseWorld:world, ui
      })
    }));
    liveBridge.codeProjects = codeProjects;
    scope.add(() => ui.attachCodeProjects?.(null));
    ui.attachCodeProjects?.(codeProjects);

    return {
      world,
      scene,
      authoringWorlds,
      studioTools,
      agentTools:codeProjects.wrapTools(agentTools),
      codeProjects,
      runtimeTestTools,
      environmentMaterializer,
      worldSurface,
      editor,
      dispose:() => scope.dispose()
    };
  } catch (error) {
    scope.dispose();
    throw error;
  }
}
