import './style.css';
import { WorldRuntime } from '../world/runtime/WorldRuntime.js';
import { createAssetModule } from '../generation/orchestration/createAssetModule.js';
import { attachGenerationRuntime } from '../generation/orchestration/GenerationRuntime.js';
import { SkillRegistry } from '../agent/skills/SkillRegistry.js';
import { registerCoreSkills } from '../agent/skills/registerCoreSkills.js';
import { AgentTools } from '../agent/AgentTools.js';
import { ToolCallingAgent } from '../agent/ToolCallingAgent.js';
import { HttpLLMGateway } from '../agent/gateway/HttpLLMGateway.js';
import { bootstrapWorld } from '../agent/bootstrapWorld.js';
import { LocalSceneStore } from './persistence/LocalSceneStore.js';
import { AutosaveController } from './persistence/AutosaveController.js';
import { EditorController } from './editor/EditorController.js';
import { ENVIRONMENTS, resolveEnvironment } from '../world/content/environments.js';
import { GenerationJobCenter } from './ui/generation/GenerationJobCenter.js';
import { createAppShell } from './ui/AppShell.js';
import { TaskPanel } from './ui/task/TaskPanel.js';
import { ObjectInspector } from './ui/inspect/ObjectInspector.js';
import { RunsPanel } from './ui/runs/RunsPanel.js';
import { DeveloperSettings } from './ui/developer/DeveloperSettings.js';
import { bindSceneControls } from './ui/bindSceneControls.js';
import { bindRuntimeEvents } from './ui/bindRuntimeEvents.js';
import { bindDebugLayers } from './debug/bindDebugLayers.js';
import { CAPABILITY_API, LOCAL_ADAPTER_HOST, applyCapabilityStatus, clearLegacyEndpointOverrides, readCapabilityStatus } from './config/capabilityEntry.js';

async function main() {
  const app = document.querySelector('#app');
  clearLegacyEndpointOverrides();
  const capabilityStatusPromise = readCapabilityStatus();
  const params = new URLSearchParams(location.search);
  const environmentDefinition = resolveEnvironment(params.get('world'));
  const environmentFactory = await environmentDefinition.load();
  const ui = createAppShell({ app, environmentDefinition, environments: ENVIRONMENTS });
  ui.setRuntimeStatus('loading', '启动中');
  const capabilityStatus = await capabilityStatusPromise;

  const world = new WorldRuntime(ui.viewport, {
    environmentFactory,
    assetModule: createAssetModule(),
    rendererMode: params.get('renderer') || 'auto'
  });
  const generation = attachGenerationRuntime(world, {
    compilerEndpoint: capabilityStatus.assetCompile.available ? CAPABILITY_API.assetCompile : '',
    connectorEndpoint: LOCAL_ADAPTER_HOST.connector
  });
  world.skills = registerCoreSkills(new SkillRegistry({ policy: world.policy, trace: world.trace, runtime: world }), world);
  world.generationState = await generation.initialize({ pair: false });
  await world.init();

  const tools = new AgentTools(world, { profile: 'builder', actor: 'agent_01' });
  const gateway = new HttpLLMGateway({ endpoint: capabilityStatus.agent.available ? CAPABILITY_API.agent : '' });
  const editor = new EditorController(world);
  const runsPanel = new RunsPanel({ root: ui.panel });
  const taskPanel = new TaskPanel({
    root: ui.panel,
    commandForm: ui.commandForm,
    commandInput: ui.commandInput,
    commandButton: ui.commandButton,
    setView: ui.setView,
    onRun: (run) => runsPanel.addRun(run)
  });
  const agent = new ToolCallingAgent({ tools, gateway, log: (text, kind) => taskPanel.log(text, kind) });
  taskPanel.attachAgent({ agent, gateway });
  taskPanel.setAvailability(capabilityStatus.agent.available);

  const inspector = new ObjectInspector({ root: ui.panel, world, tools, log: (text, kind) => taskPanel.log(text, kind) });
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
  new AutosaveController({ runtime: world, store: sceneStore, delayMs: 600 }).start();

  bindRuntimeEvents({ world, editor, inspector, taskPanel, ui });
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
  const rendererBackendLabel = world.rendererInfo?.backend === 'webgpu' ? 'WebGPU' : (world.rendererInfo?.backend === 'webgl2' ? 'WebGL2' : '未知后端');
  ui.setRuntimeStatus('ready', `就绪 · ${rendererBackendLabel}`);
  taskPanel.log(`场景已就绪 · ${world.listObjects().length} 个对象 · ${world.rendererInfo?.renderer || 'Renderer'} / ${rendererBackendLabel}${world.rendererInfo?.fallback ? ' fallback' : ''}`, 'result');
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
