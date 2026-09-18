import { createSession } from '../../application/createSession.js';
import { RuntimeDriver } from './runtime/RuntimeDriver.js';
import { WorldSession } from './runtime/WorldSession.js';
import { StudioWorldOpener } from './runtime/StudioWorldOpener.js';
import { materializePersistedWorldEnvironment } from '../../application/generation/PromptHybridWorldOrchestrator.js';
import { AgentTools } from '../../application/AgentTools.js';
import { ToolCallingAgent } from '../../modules/agent/ToolCallingAgent.js';
import { HttpLLMGateway } from '../../modules/agent/gateway/HttpLLMGateway.js';
import { LocalSceneStore } from './persistence/LocalSceneStore.js';
import { AutosaveController } from './persistence/AutosaveController.js';
import { AuthoringWorldStore } from './persistence/AuthoringWorldStore.js';
import { AuthoringWorldController } from './authoring/AuthoringWorldController.js';
import { bindAuthoringWorldControls } from './authoring/bindAuthoringWorldControls.js';
import { createAuthoringModelResolver } from '../../application/world-authoring/AuthoringModelResolver.js';
import { EditorController } from './editor/EditorController.js';
import { AssetPlacementController } from './editor/AssetPlacementController.js';
import { ENVIRONMENTS, resolveEnvironment } from '../../modules/world/content/environments.js';
import { loadGeneratedWorld, loadGeneratedWorldManifest } from '../../modules/world/generated/GeneratedWorldLoader.js';
import { GenerationJobCenter } from './ui/generation/GenerationJobCenter.js';
import { createAppShell } from './ui/AppShell.js';
import { builtInWorldUrl } from './ui/chrome/StudioChrome.js';
import { mountWorldContext } from './ui/WorldContext.js';
import { mountWorldInteraction } from './ui/WorldInteraction.js';
import { StudioEnvironmentMaterializer } from './ui/StudioEnvironmentMaterializer.js';
import { HumanViewController } from './ui/HumanViewController.js';
import { TaskPanel } from './ui/task/TaskPanel.js';
import { GeneratedPlacementDemoRunner } from './demos/generated-placement/GeneratedPlacementDemoRunner.js';
import { mountObjectInspector } from './react/inspect/ObjectInspector.tsx';
import { RunsPanel } from './ui/runs/RunsPanel.js';
import { ResourceLibrary } from './ui/resources/ResourceLibrary.js';
import { StudioResources } from './resources/StudioResources.js';
import { DeveloperSettings } from './ui/developer/DeveloperSettings.js';
import { mountSceneExplorer } from './react/scene/SceneExplorer.tsx';
import { useStudioStore } from './react/state/studioStore.ts';
import { mountBuildWorkbench } from './react/build/BuildWorkbench.tsx';
import { mountArtifactTray } from './react/artifacts/ArtifactTray.tsx';
import { BuildSession } from './build/BuildSession.js';
import { StudioBuildController } from './build/StudioBuildController.js';
import { AssetAgentVerifier } from './agent/AssetAgentVerifier.js';
import { AgentRuntimeTestRunner } from './agent/AgentRuntimeTestRunner.js';
import { bindSceneControls } from './ui/bindSceneControls.js';
import { bindRuntimeEvents } from './ui/bindRuntimeEvents.js';
import { bindDebugLayers } from './debug/bindDebugLayers.js';
import { CAPABILITY_API, LOCAL_ADAPTER_HOST, applyCapabilityStatus, clearLegacyEndpointOverrides, readCapabilityStatus } from './config/capabilityEntry.js';

async function main() {
  const app = document.querySelector('#app');
  clearLegacyEndpointOverrides();
  const capabilityStatusPromise = readCapabilityStatus();
  const params = new URLSearchParams(location.search);
  const generatedWorldManifest = params.get('worldManifest');
  const generatedMesh = params.get('mesh');
  const environmentDefinition = generatedWorldManifest
    ? {
        id:'generated-world', number:'GENERATED', title:'生成世界', headline:'运行外部生成世界。',
        description:'从统一 Runtime Manifest 加载外部生成世界。',
        facts:['WORLD MANIFEST','RAPIER','RECAST / DETOUR'], bootstrap:{agent:[0,0,0]}, coffeeCorner:{},
        load:async()=>async()=>loadGeneratedWorldManifest(generatedWorldManifest)
      }
    : generatedMesh
    ? {
        id:'generated-world', number:'GENERATED', title:'生成世界', headline:'运行外部生成世界。',
        description:'外部生成文件直接进入 AgentScape 现有渲染、物理与导航运行时。',
        facts:['GENERATED MESH','RAPIER','RECAST / DETOUR'], bootstrap:{agent:[0,0,0]}, coffeeCorner:{},
        load:async()=>async()=>loadGeneratedWorld({
          mesh:generatedMesh,
          visual:params.get('visual'),
          semantics:params.get('semantics'),
          coordinateSystem:params.get('up') === 'z' ? 'z-up' : 'y-up'
        })
      }
    : resolveEnvironment(params.get('world'));
  const ui = createAppShell({ app, environmentDefinition, environments: ENVIRONMENTS });
  window.addEventListener('pagehide', () => ui.destroyChrome?.(), { once:true });
  const environmentMaterializer = new StudioEnvironmentMaterializer({ parent:ui.shell });
  ui.setRuntimeStatus('loading', '启动中');
  const capabilityStatus = await capabilityStatusPromise;

  const { world, generation, authoring } = createSession(ui.viewport, {
    environmentFactory: options => environmentMaterializer.materialize(environmentDefinition, options),
    rendererMode: params.get('renderer') || 'auto',
    rendererTiming: params.get('gpuTiming') === '1',
    generation: {
      assetInputPolicy: 'approved-image',
      compilerEndpoint: capabilityStatus.assetCompile.available ? CAPABILITY_API.assetCompile : '',
      connectorEndpoint: LOCAL_ADAPTER_HOST.connector
    }
  });
  world.generationState = await generation.initialize({ pair: false });
  await world.init();
  const resolveAuthoringModel = authoring ? createAuthoringModelResolver({
    assetLoader:world.assetModule.loader,
    gltfLoader:{ loadScene:(uri) => world.assetModule.loader.loadGLB(uri) }
  }) : null;
  const authoringWorlds = authoring ? new AuthoringWorldController({
    authoring,
    store:new AuthoringWorldStore(),
    resolveModel:resolveAuthoringModel
  }) : null;
  let editorRef = null;
  let humanView = null;
  const runtimeDriver = new RuntimeDriver(world, {
    authoring,
    // The human view owns the camera while it is active; orbit keeps owning it otherwise.
    syncInput: (frameTime) => {
      humanView?.update(frameTime);
      world.commands.setHumanViewPose(humanView?.viewPose?.() || world.rendering?.viewPose?.() || null);
    }
  }).start();

  const studioTools = new AgentTools(world, { profile:'builder', actor:'agent_01', source:'studio-ui' });
  const agentTools = new AgentTools(world, { profile:'builder', actor:'agent_01', source:'agent' });
  const runtimeTestTools = new AgentTools(world, { profile:'builder', actor:'agent_01', source:'runtime-test' });
  const gateway = new HttpLLMGateway({ endpoint: capabilityStatus.agent.available ? CAPABILITY_API.agent : '' });
  const editor = new EditorController(world);
  editorRef = editor;
  let worldInteraction = null;
  let worldContext = null;
  window.addEventListener('pagehide',()=>{
    worldInteraction?.dispose();
    worldContext?.dispose();
    humanView?.dispose();
    editor.dispose();
  },{once:true});
  const runsPanel = new RunsPanel({ root: ui.panel });
  let taskPanel = null;
  const generatedPlacementDemo = new GeneratedPlacementDemoRunner({ world, log: (text, kind) => taskPanel?.log?.(text, kind) });
  const runtimeTestRunner = new AgentRuntimeTestRunner({ tools:runtimeTestTools, actorId:'agent_01', log:(text,kind)=>taskPanel?.log?.(text,kind) });
  taskPanel = new TaskPanel({
    root: ui.panel,
    commandForm: ui.commandForm,
    commandInput: ui.commandInput,
    commandButton: ui.commandButton,
    setView: ui.setView,
    onRun: (run) => runsPanel.addRun(run),
    demoRunners: { 'generated-placement': generatedPlacementDemo },
    runtimeTestRunner
  });
  const agent = new ToolCallingAgent({ tools:agentTools, gateway, log: (text, kind) => taskPanel.log(text, kind) });
  taskPanel.attachAgent({ agent, gateway });
  taskPanel.setAvailability(capabilityStatus.agent.available);

  const placement = new AssetPlacementController({
    world,
    tools:studioTools,
    editor,
    log: (text, kind) => taskPanel.log(text, kind)
  });
  let worldSession=null;
  let worldOpener=null;
  const rebindEnvironmentSurface = ({ identity = worldSession?.current } = {}) => {
    const worldFirst=Boolean(identity?.worldFirst);
    const nextInteraction=mountWorldInteraction({
      world,
      ui,
      editor,
      host:environmentMaterializer.hostFor(world.environment)
    });
    const previousInteraction=worldInteraction;
    const previousHumanView=humanView;
    const previousWorldContext=worldContext;
    let nextHumanView=humanView;
    let nextWorldContext=worldContext;
    let createdHumanView=false;
    let createdWorldContext=false;

    try {
      if(worldFirst && !nextHumanView) {
        nextHumanView=new HumanViewController({world,ui,blockLook:()=>Boolean(editorRef?.transform?.axis)});
        createdHumanView=true;
      }
      if(worldFirst && !nextWorldContext) {
        nextWorldContext=mountWorldContext({world,editor,tools:studioTools,ui});
        createdWorldContext=true;
      }
    } catch(error) {
      nextInteraction?.dispose();
      if(createdHumanView) nextHumanView?.dispose();
      if(createdWorldContext) nextWorldContext?.dispose();
      throw error;
    }

    worldInteraction=nextInteraction;
    humanView=worldFirst ? nextHumanView : null;
    worldContext=worldFirst ? nextWorldContext : null;
    editor.setSelectionOnRelease(worldFirst);
    humanView?.resetForEnvironment();
    editor.select(null);
    previousInteraction?.dispose();
    if(previousHumanView && previousHumanView!==humanView) previousHumanView.dispose();
    if(previousWorldContext && previousWorldContext!==worldContext) previousWorldContext.dispose();
  };
  // Presentation owns dock DOM; the application only registers an action.
  ui.addDockAction?.({
    id:'generation-anchor',
    label:'生成落点',
    title:'在当前世界指定生成物落点',
    onClick:() => {
      const ready = useStudioStore.getState().buildOutputs.find((output) => output.kind === 'asset');
      if (ready && placement.armGroundPlacement(ready.primaryId)) {
        taskPanel.log(`点击地面放置生成物：${ready.prompt || ready.primaryId}`, 'tool');
        return;
      }
      if (placement.anchor) {
        placement.clearAnchor();
        taskPanel.log('已清除生成落点', 'result');
        return;
      }
      placement.armGenerationAnchor();
    }
  });
  const openGeneratedWorld = async (manifestArtifactId) => {
    if(!worldOpener) throw new Error('StudioWorldOpener is not ready');
    const result=await worldOpener.open({kind:'generated',artifactId:manifestArtifactId});
    taskPanel.log(`已打开生成世界：${result.environmentId || manifestArtifactId} · 清理 ${result.clearedObjects || 0} 个对象`,'result');
    return result;
  };
  const openBuiltinWorld = async (id) => {
    if(!worldOpener) throw new Error('StudioWorldOpener is not ready');
    const result=await worldOpener.open({kind:'builtin',id});
    globalThis.history?.replaceState?.(globalThis.history.state,'',builtInWorldUrl(location.href,id));
    taskPanel.log(`已打开内置世界：${worldSession.current.title}`,'result');
    return result;
  };
  const resources = new StudioResources({
    assetModule:world.assetModule,
    artifactModule:world.generation.artifacts,
    events:world.events,
    getEnvironment:()=>world.environment,
    environments:ENVIRONMENTS
  });
  const sceneExplorer = mountSceneExplorer({
    root:ui.scenePanel,
    world,
    editor,
    environmentDefinition,
    resources,
    placement,
    openLibrary:()=>ui.setView('resources'),
    openCreate:()=>ui.setView('create')
  });
  const buildSession = new BuildSession({ mode:'image' });
  const buildController = new StudioBuildController({
    generation:world.generation,
    events:world.events,
    syncGenerationState:(state)=>{ world.generationState=state; },
    placement,
    openGeneratedWorld,
    log:(text,kind)=>taskPanel.log(text,kind)
  });
  const buildWorkbench = mountBuildWorkbench({
    root:ui.panel,
    resources,
    session:buildSession,
    controller:buildController,
    environmentDefinition,
    log:(text,kind)=>taskPanel.log(text,kind)
  });
  const resourceLibrary = new ResourceLibrary({
    root: ui.panel,
    resources,
    placement,
    log: (text, kind) => taskPanel.log(text, kind),
    openEnvironment: openBuiltinWorld,
    openGeneratedWorld
  }).init();
  const inspector = mountObjectInspector({ root: ui.panel, world, tools:studioTools, log: (text, kind) => taskPanel.log(text, kind) });
  const agentVerifier = new AssetAgentVerifier({
    world,
    tools:studioTools,
    actorId:'agent_01',
    log:(text,kind)=>taskPanel.log(text,kind)
  });
  const artifactTray = mountArtifactTray({
    root:app,
    resources,
    controller:buildController,
    agentVerifier,
    openBuild:()=>ui.setView('create'),
    log:(text,kind)=>taskPanel.log(text,kind)
  });
  window.addEventListener('pagehide', () => { artifactTray.destroy(); buildWorkbench.destroy(); sceneExplorer.destroy(); inspector.destroy(); resourceLibrary.destroy(); placement.dispose(); }, { once:true });

  const developer = new DeveloperSettings({
    dialog: ui.developerDialog,
    world,
    tools:studioTools,
    gateway,
    initialCapabilityStatus: capabilityStatus,
    log: (text, kind) => taskPanel.log(text, kind),
    onCapabilityStatusChange: (status) => {
      applyCapabilityStatus({ gateway, generation: world.generation }, status);
      taskPanel.setAvailability(status.agent.available);
    }
  }).init();
  taskPanel.setOpenSettingsHandler(() => developer.open());
  ui.developerButton.addEventListener('click', () => developer.open());
  ui.setLayoutChangeHandler(() => world.rendering?.resize?.());

  const generationJobCenter = await new GenerationJobCenter({ root: ui.panel, world, tools:studioTools, log: (text, kind) => taskPanel.log(text, kind) }).init();
  window.addEventListener('pagehide', () => generationJobCenter.destroy(), { once:true });

  const sceneStore = new LocalSceneStore();
  const autosave = new AutosaveController({ runtime:world, store:sceneStore, delayMs:600 }).start();
  worldSession = new WorldSession({
    world,
    tools:studioTools,
    store:sceneStore,
    autosave,
    builtins:ENVIRONMENTS,
    fallback:environmentDefinition,
    onIdentityChange:(identity)=>{
      useStudioStore.getState().setWorldPresentation(identity);
      ui.setWorldPresentation?.(identity);
      editor.select(null);
    },
    onEnvironmentChange:(event)=>rebindEnvironmentSurface(event),
    log:(text,kind)=>taskPanel.log(text,kind)
  });
  worldOpener = new StudioWorldOpener({
    session:worldSession,
    builtins:ENVIRONMENTS,
    materializeBuiltin:(definition)=>environmentMaterializer.materialize(definition,{scene:world.scene}),
    materializeGenerated:(artifactId)=>materializePersistedWorldEnvironment(world,artifactId),
    authoring:authoringWorlds
  });
  ui.setWorldChangeHandler?.((id)=>openBuiltinWorld(id).catch((error)=>{
    taskPanel.log(`打开世界失败：${error.message}`,'error');
    throw error;
  }));
  if (!worldSession.current.generated && worldSession.current.id === 'monument-hall' && !sceneStore.has()) {
    const legacy = new LocalSceneStore();
    if (legacy.has()) sceneStore.save(legacy.load());
  }
  window.addEventListener('pagehide',()=>worldSession?.dispose(),{once:true});

  bindRuntimeEvents({ world, editor, inspector, taskPanel, ui, autosave });
  bindDebugLayers(world, { log: (text, kind) => taskPanel.log(text, kind) });
  await worldOpener.open({kind:'current'});
  rebindEnvironmentSurface({identity:worldSession.current});
  bindSceneControls({
    root: app,
    world,
    editor,
    sceneStore,
    worldSession,
    log: (text, kind) => taskPanel.log(text, kind),
    setTaskState: (...args) => taskPanel.setState(...args)
  });
  const authoringControls = authoringWorlds ? bindAuthoringWorldControls({
    root:app,
    controller:authoringWorlds,
    openWorld:(id)=>worldOpener.open({kind:'authoring',id}),
    newWorld:(options)=>worldOpener.open({kind:'authoring-new',options}),
    log:(text, kind) => taskPanel.log(text, kind)
  }) : null;
  window.addEventListener('pagehide', () => authoringControls?.dispose(), { once:true });
  window.addEventListener('pagehide', () => {
    runtimeDriver.dispose();
    authoring?.dispose();
    world.dispose();
  }, { once:true });

  inspector.render(null);
  world.history.clear();
  const rendering = world.rendering?.diagnostics?.() || {};
  const rendererBackendLabel = rendering.backend === 'webgpu' ? 'WebGPU' : (rendering.backend === 'webgl2' ? 'WebGL2' : '未知后端');
  ui.setRuntimeStatus('ready', `就绪 · ${rendererBackendLabel}`);
  taskPanel.log(`场景已就绪 · ${world.queries.listObjects().length} 个对象 · ${rendering.renderer || 'Renderer'} / ${rendererBackendLabel}${rendering.fallback ? ' fallback' : ''}`, 'result');
}

main().catch((error) => {
  console.error(error);
  const panel = document.createElement('main');
  panel.className = 'startup-error';
  const heading = document.createElement('strong');
  heading.textContent = 'AgentScape 启动失败';
  const detail = document.createElement('p');
  detail.textContent = error?.message || '未知启动错误';
  const reload = document.createElement('button');
  reload.type = 'button';
  reload.textContent = '重新加载';
  reload.addEventListener('click', () => location.reload());
  panel.append(heading, detail, reload);
  document.body.replaceChildren(panel);
});
