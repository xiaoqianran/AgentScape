import { ENVIRONMENTS } from '../../modules/world/content/environments.js';
import { createAppShell } from './ui/AppShell.js';
import { clearLegacyEndpointOverrides, readCapabilityStatus } from './config/capabilityEntry.js';
import { resolveStudioEnvironment } from './bootstrap/resolveStudioEnvironment.js';
import { parseStudioRoute } from './navigation/StudioRoutes.js';
import { createStudioStartupMetrics } from './bootstrap/studioStartupMetrics.js';

async function main() {
  const metrics = createStudioStartupMetrics();
  metrics.mark('start');
  const app = document.querySelector('#app');
  clearLegacyEndpointOverrides();

  const params = new URLSearchParams(location.search);
  const environmentDefinition = resolveStudioEnvironment(params);

  const ui = createAppShell({
    app,
    environmentDefinition,
    environments:ENVIRONMENTS
  });
  metrics.mark('shell-ready');
  const route = parseStudioRoute(location.href);
  if (route.page === 'worlds' && params.get('fullRuntime') !== '1') {
    const { createStudioLightweightWorkspace } = await import('./bootstrap/createStudioLightweightWorkspace.js');
    const workspace = createStudioLightweightWorkspace({ ui, environments:ENVIRONMENTS });
    metrics.mark('worlds-ready');
    window.addEventListener('pagehide',()=>{ workspace.dispose(); ui.destroyChrome?.(); },{once:true});
    return;
  }

  ui.setRuntimeStatus('loading','启动中');
  const capabilityStatus = await readCapabilityStatus();
  metrics.mark('capabilities-ready');
  const [{ createStudioRuntime },{ createStudioAgent },{ createStudioWorldLifecycle },{ createStudioWorkspace }] = await Promise.all([
    import('./bootstrap/createStudioRuntime.js'),
    import('./bootstrap/createStudioAgent.js'),
    import('./bootstrap/createStudioWorldLifecycle.js'),
    import('./bootstrap/createStudioWorkspace.js')
  ]);
  metrics.mark('runtime-modules-ready');
  const runtime = await createStudioRuntime({
    ui,
    environmentDefinition,
    params,
    capabilityStatus,
    metrics
  });

  metrics.mark('runtime-ready');
  const agent = createStudioAgent({
    ui,
    world:runtime.world,
    scene:runtime.scene,
    agentTools:runtime.agentTools,
    codeProjects:runtime.codeProjects,
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
    ui,
    environmentDefinition,
    environments:ENVIRONMENTS,
    capabilityStatus,
    world:runtime.world,
    scene:runtime.scene,
    authoringWorlds:runtime.authoringWorlds,
    studioTools:runtime.studioTools,
    editor:runtime.editor,
    worldSurface:runtime.worldSurface,
    taskPanel:agent.taskPanel,
    gateway:agent.gateway,
    lifecycle,
    codeProjects:runtime.codeProjects
  });

  metrics.mark('workspace-ready');
  if (params.get('openCode') === '1') {
    const url = new URL(location.href);
    url.searchParams.set('page','world');
    url.searchParams.delete('openCode');
    history.replaceState(history.state,'',url.href);
    runtime.codeProjects.show();
  }
  window.addEventListener('pagehide',()=>{
    workspace.dispose();
    lifecycle.dispose();
    agent.dispose?.();
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
