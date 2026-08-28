import './style.css';
import { WorldRuntime } from './runtime/WorldRuntime.js';
import { createAssetModule } from './assets/createAssetModule.js';
import { attachLegacyAuthoring } from './authoring/LegacyAuthoringShell.js';
import { SkillRegistry } from './skills/SkillRegistry.js';
import { registerCoreSkills } from './skills/registerCoreSkills.js';
import { AgentTools } from './agent/AgentTools.js';
import { ToolCallingAgent } from './agent/ToolCallingAgent.js';
import { HttpLLMGateway } from './agent/gateway/HttpLLMGateway.js';
import { bootstrapWorld } from './agent/bootstrapWorld.js';
import { LocalSceneStore } from './persistence/LocalSceneStore.js';
import { AutosaveController } from './persistence/AutosaveController.js';
import { EditorController } from './editor/EditorController.js';
import { ENVIRONMENTS, resolveEnvironment } from './content/environments.js';
import { GenerationJobCenter } from './authoring/GenerationJobCenter.js';
import { createAppShell } from './ui/AppShell.js';
import { TaskPanel } from './ui/task/TaskPanel.js';
import { ObjectInspector } from './ui/inspect/ObjectInspector.js';
import { RunsPanel } from './ui/runs/RunsPanel.js';
import { DeveloperSettings } from './ui/developer/DeveloperSettings.js';
import { bindSceneControls } from './ui/bindSceneControls.js';
import { bindRuntimeEvents } from './ui/bindRuntimeEvents.js';

async function main() {
  const app = document.querySelector('#app');
  const environmentDefinition = resolveEnvironment(new URLSearchParams(location.search).get('world'));
  const environmentFactory = await environmentDefinition.load();
  const ui = createAppShell({ app, environmentDefinition, environments: ENVIRONMENTS });
  ui.setRuntimeStatus('loading', 'Starting');

  const world = new WorldRuntime(ui.viewport, {
    environmentFactory,
    assetModule: createAssetModule()
  });
  const authoring = attachLegacyAuthoring(world);
  world.skills = registerCoreSkills(new SkillRegistry({ policy: world.policy, trace: world.trace, runtime: world }), world);
  await authoring.initialize({ pair: true });
  await world.init();

  const tools = new AgentTools(world, { profile: 'builder', actor: 'agent_01' });
  const gateway = new HttpLLMGateway({ endpoint: localStorage.getItem('agentscape.gatewayEndpoint') || '' });
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

  const inspector = new ObjectInspector({ root: ui.panel, world, tools, log: (text, kind) => taskPanel.log(text, kind) });
  const developer = new DeveloperSettings({
    dialog: ui.developerDialog,
    world,
    tools,
    gateway,
    log: (text, kind) => taskPanel.log(text, kind),
    onGatewayChange: (available) => taskPanel.setAvailability(available)
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
  ui.setRuntimeStatus('ready', 'Ready');
  taskPanel.log(`scene ready · ${world.listObjects().length} objects`, 'result');
}

async function restoreOrBootstrap({ world, tools, sceneStore, environmentDefinition, taskPanel }) {
  if (!sceneStore.has()) {
    await bootstrapWorld(tools, environmentDefinition.bootstrap);
    return;
  }
  try {
    await world.restore(sceneStore.load());
    taskPanel.log('autosave restored', 'result');
    const hasAgent = world.store.list().some(([, record]) => record.manifest.type === 'agent');
    if (!hasAgent && environmentDefinition.bootstrap.agent) {
      await tools.call('spawnAsset', { assetId: 'agent', position: environmentDefinition.bootstrap.agent, instanceId: 'agent_01' });
      taskPanel.log('legacy autosave upgraded · agent_01 added', 'result');
    }
  } catch (error) {
    taskPanel.log(`autosave restore failed: ${error.message}`, 'error');
    await bootstrapWorld(tools, environmentDefinition.bootstrap);
  }
}

main().catch((error) => {
  console.error(error);
  const panel = document.createElement('main');
  panel.className = 'startup-error';
  const heading = document.createElement('strong');
  heading.textContent = 'AgentScape failed to start';
  const detail = document.createElement('p');
  detail.textContent = error?.message || 'Unknown startup error';
  const reload = document.createElement('button');
  reload.type = 'button';
  reload.textContent = 'Reload';
  reload.addEventListener('click', () => location.reload());
  panel.append(heading, detail, reload);
  document.body.replaceChildren(panel);
});
