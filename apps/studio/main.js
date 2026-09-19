import { ENVIRONMENTS } from '../../modules/world/content/environments.js';
import { createAppShell } from './ui/AppShell.js';
import { clearLegacyEndpointOverrides, readCapabilityStatus } from './config/capabilityEntry.js';
import { resolveStudioEnvironment } from './bootstrap/resolveStudioEnvironment.js';
import { createStudioRuntime } from './bootstrap/createStudioRuntime.js';
import { createStudioAgent } from './bootstrap/createStudioAgent.js';
import { createStudioWorldLifecycle } from './bootstrap/createStudioWorldLifecycle.js';
import { createStudioWorkspace } from './bootstrap/createStudioWorkspace.js';

async function main() {
  const app = document.querySelector('#app');
  clearLegacyEndpointOverrides();

  const capabilityStatusPromise = readCapabilityStatus();
  const params = new URLSearchParams(location.search);
  const environmentDefinition = resolveStudioEnvironment(params);

  const ui = createAppShell({
    app,
    environmentDefinition,
    environments:ENVIRONMENTS
  });
  ui.setRuntimeStatus('loading','启动中');

  const capabilityStatus = await capabilityStatusPromise;
  const runtime = await createStudioRuntime({
    ui,
    environmentDefinition,
    params,
    capabilityStatus
  });

  const agent = createStudioAgent({
    ui,
    world:runtime.world,
    agentTools:runtime.agentTools,
    runtimeTestTools:runtime.runtimeTestTools,
    capabilityStatus
  });

  const lifecycle = createStudioWorldLifecycle({
    world:runtime.world,
    studioTools:runtime.studioTools,
    environmentDefinition,
    environmentMaterializer:runtime.environmentMaterializer,
    authoringWorlds:runtime.authoringWorlds,
    worldSurface:runtime.worldSurface,
    taskPanel:agent.taskPanel
  });

  const workspace = await createStudioWorkspace({
    app,
    ui,
    environmentDefinition,
    environments:ENVIRONMENTS,
    capabilityStatus,
    world:runtime.world,
    authoringWorlds:runtime.authoringWorlds,
    studioTools:runtime.studioTools,
    editor:runtime.editor,
    worldSurface:runtime.worldSurface,
    taskPanel:agent.taskPanel,
    gateway:agent.gateway,
    lifecycle
  });

  window.addEventListener('pagehide',()=>{
    workspace.dispose();
    lifecycle.dispose();
    runtime.dispose();
    ui.destroyChrome?.();
  },{ once:true });
}

main().catch((error)=>{
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
  reload.addEventListener('click',()=>location.reload());

  panel.append(heading,detail,reload);
  document.body.replaceChildren(panel);
});
