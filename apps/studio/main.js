import './style.css';
import { createSession } from '../../application/createSession.js';
import { RuntimeDriver } from './runtime/RuntimeDriver.js';
import { replaceStudioEnvironment } from './runtime/replaceStudioEnvironment.js';
import { materializePersistedWorldEnvironment } from '../../application/generation/PromptHybridWorldOrchestrator.js';
import { AgentTools } from '../../application/AgentTools.js';
import { ToolCallingAgent } from '../../modules/agent/ToolCallingAgent.js';
import { HttpLLMGateway } from '../../modules/agent/gateway/HttpLLMGateway.js';
import { bootstrapWorld } from '../../modules/agent/bootstrapWorld.js';
import { LocalSceneStore } from './persistence/LocalSceneStore.js';
import { AutosaveController } from './persistence/AutosaveController.js';
import { EditorController } from './editor/EditorController.js';
import { AssetPlacementController } from './editor/AssetPlacementController.js';
import { ENVIRONMENTS, resolveEnvironment } from '../../modules/world/content/environments.js';
import { loadGeneratedWorld, loadGeneratedWorldManifest } from '../../modules/world/loadGeneratedWorld.js';
import { GenerationJobCenter } from './ui/generation/GenerationJobCenter.js';
import { createAppShell } from './ui/AppShell.js';
import { TaskPanel } from './ui/task/TaskPanel.js';
import { GeneratedPlacementDemoRunner } from './demos/generated-placement/GeneratedPlacementDemoRunner.js';
import { mountObjectInspector } from './react/inspect/ObjectInspector.tsx';
import { RunsPanel } from './ui/runs/RunsPanel.js';
import { ResourceLibrary } from './ui/resources/ResourceLibrary.js';
import { DeveloperSettings } from './ui/developer/DeveloperSettings.js';
import { mountSceneExplorer } from './react/scene/SceneExplorer.tsx';
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
  const environmentFactory = await environmentDefinition.load();
  const ui = createAppShell({ app, environmentDefinition, environments: ENVIRONMENTS });
  ui.setRuntimeStatus('loading', '启动中');
  const capabilityStatus = await capabilityStatusPromise;

  const { world, generation } = createSession(ui.viewport, {
    environmentFactory,
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
  const runtimeDriver = new RuntimeDriver(world, {
    syncInput: () => world.interactions?.setHumanViewPose(world.rendering?.viewPose?.() || null)
  }).start();
  window.addEventListener('beforeunload', () => { runtimeDriver.dispose(); world.dispose(); }, { once:true });

  const tools = new AgentTools(world, { profile: 'builder', actor: 'agent_01' });
  const gateway = new HttpLLMGateway({ endpoint: capabilityStatus.agent.available ? CAPABILITY_API.agent : '' });
  const editor = new EditorController(world);
  const sceneExplorer = mountSceneExplorer({ root: ui.scenePanel, world, editor, environmentDefinition });
  const runsPanel = new RunsPanel({ root: ui.panel });
  let taskPanel = null;
  const generatedPlacementDemo = new GeneratedPlacementDemoRunner({ world, log: (text, kind) => taskPanel?.log?.(text, kind) });
  const runtimeTestRunner = new AgentRuntimeTestRunner({ tools, actorId:'agent_01', log:(text,kind)=>taskPanel?.log?.(text,kind) });
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
  const agent = new ToolCallingAgent({ tools, gateway, log: (text, kind) => taskPanel.log(text, kind) });
  taskPanel.attachAgent({ agent, gateway });
  taskPanel.setAvailability(capabilityStatus.agent.available);

  const placement = new AssetPlacementController({
    world,
    tools,
    editor,
    log: (text, kind) => taskPanel.log(text, kind)
  });
  const openGeneratedWorld = async (manifestArtifactId) => {
    const nextEnvironment=await materializePersistedWorldEnvironment(world,manifestArtifactId);
    const result=await replaceStudioEnvironment(world,nextEnvironment,{reason:'studio-generated-world'});
    taskPanel.log(`已打开生成世界：${nextEnvironment.id || manifestArtifactId} · 清理 ${result.clearedObjects} 个对象`,'result');
    return result;
  };
  const buildSession = new BuildSession({ mode:'image' });
  const buildController = new StudioBuildController({
    world,
    placement,
    openGeneratedWorld,
    log:(text,kind)=>taskPanel.log(text,kind)
  });
  const buildWorkbench = mountBuildWorkbench({
    root:ui.panel,
    world,
    session:buildSession,
    controller:buildController,
    environmentDefinition,
    log:(text,kind)=>taskPanel.log(text,kind)
  });
  const resourceLibrary = new ResourceLibrary({
    root: ui.panel,
    world,
    environments: ENVIRONMENTS,
    placement,
    log: (text, kind) => taskPanel.log(text, kind),
    openEnvironment: (id) => {
      const url = new URL(location.href);
      url.searchParams.delete('worldManifest');
      url.searchParams.delete('mesh');
      url.searchParams.delete('visual');
      url.searchParams.delete('semantics');
      url.searchParams.set('world', id);
      location.href = url.toString();
    },
    openGeneratedWorld
  }).init();
  const inspector = mountObjectInspector({ root: ui.panel, world, tools, log: (text, kind) => taskPanel.log(text, kind) });
  const agentVerifier = new AssetAgentVerifier({
    world,
    tools,
    actorId:'agent_01',
    log:(text,kind)=>taskPanel.log(text,kind)
  });
  const artifactTray = mountArtifactTray({
    root:app,
    world,
    controller:buildController,
    agentVerifier,
    openBuild:()=>ui.setView('create'),
    log:(text,kind)=>taskPanel.log(text,kind)
  });
  window.addEventListener('beforeunload', () => { artifactTray.destroy(); buildWorkbench.destroy(); sceneExplorer.destroy(); inspector.destroy(); resourceLibrary.destroy(); placement.dispose(); }, { once:true });

  const developer = new DeveloperSettings({
    dialog: ui.developerDialog,
    world,
    tools,
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
  ui.setLayoutChangeHandler(() => world.resize());

  await new GenerationJobCenter({ root: ui.panel, world, tools, log: (text, kind) => taskPanel.log(text, kind) }).init();

  const sceneStore = new LocalSceneStore({ key: `agentscape.scene.autosave.${environmentDefinition.id}` });
  if (environmentDefinition.id === 'monument-hall' && !sceneStore.has()) {
    const legacy = new LocalSceneStore();
    if (legacy.has()) sceneStore.save(legacy.load());
  }
  const autosave = new AutosaveController({ runtime: world, store: sceneStore, delayMs: 600 }).start();

  bindRuntimeEvents({ world, editor, inspector, taskPanel, ui, autosave });
  bindDebugLayers(world, { log: (text, kind) => taskPanel.log(text, kind) });
  await restoreOrBootstrap({ world, tools, sceneStore, environmentDefinition, taskPanel });
  bindSceneControls({
    root: app,
    world,
    editor,
    sceneStore,
    tools,
    environmentDefinition,
    log: (text, kind) => taskPanel.log(text, kind),
    setTaskState: (...args) => taskPanel.setState(...args)
  });

  inspector.render(null);
  world.history.clear();
  const rendering = world.renderingDiagnostics?.() || {};
  const rendererBackendLabel = rendering.backend === 'webgpu' ? 'WebGPU' : (rendering.backend === 'webgl2' ? 'WebGL2' : '未知后端');
  ui.setRuntimeStatus('ready', `就绪 · ${rendererBackendLabel}`);
  taskPanel.log(`场景已就绪 · ${world.listObjects().length} 个对象 · ${rendering.renderer || 'Renderer'} / ${rendererBackendLabel}${rendering.fallback ? ' fallback' : ''}`, 'result');
}

async function restoreOrBootstrap({ world, tools, sceneStore, environmentDefinition, taskPanel }) {
  if (!sceneStore.has()) {
    await bootstrapWorld(tools, environmentDefinition.bootstrap);
    return;
  }
  try {
    await world.restore(sceneStore.load());
    taskPanel.log('已恢复自动保存', 'result');
    const hasAgent = world.store.list().some(([, record]) => record.manifest.type === 'agent');
    if (!hasAgent && environmentDefinition.bootstrap.agent) {
      await tools.call('spawnAsset', { assetId: 'agent', position: environmentDefinition.bootstrap.agent, instanceId: 'agent_01' });
      taskPanel.log('旧版自动保存已升级 · 已加入 agent_01', 'result');
    }
  } catch (error) {
    taskPanel.log(`恢复自动保存失败：${error.message}`, 'error');
    await bootstrapWorld(tools, environmentDefinition.bootstrap);
  }
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
