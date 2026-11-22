import { ENVIRONMENTS } from '../../modules/world/content/environments.js';
import { createAppShell } from './ui/AppShell.js';
import { clearLegacyEndpointOverrides, readCapabilityStatus } from './config/capabilityEntry.js';
import { resolveStudioEnvironment } from './bootstrap/resolveStudioEnvironment.js';
import { parseStudioRoute } from './navigation/StudioRoutes.js';
import { createStudioStartupMetrics } from './bootstrap/studioStartupMetrics.js';
import { createStudioStartupScope } from './bootstrap/createStudioStartupScope.js';

const startup = createStudioStartupScope();

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
  startup.add(() => ui.destroyChrome?.());
  metrics.mark('shell-ready');
  const route = parseStudioRoute(location.href);
  if (route.page === 'worlds' && params.get('fullRuntime') !== '1') {
    const { createStudioLightweightWorkspace } = await import('./bootstrap/createStudioLightweightWorkspace.js');
    startup.add(createStudioLightweightWorkspace({ ui, environments:ENVIRONMENTS }));
    metrics.mark('worlds-ready');
    window.addEventListener('pagehide',()=>startup.dispose(),{once:true});
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
  const runtime = startup.add(await createStudioRuntime({
    ui,
    environmentDefinition,
    params,
    capabilityStatus,
    metrics
  }));

  metrics.mark('runtime-ready');
  const agent = startup.add(createStudioAgent({
    ui,
    world:runtime.world,
    scene:runtime.scene,
    agentTools:runtime.agentTools,
    codeProjects:runtime.codeProjects,
    runtimeTestTools:runtime.runtimeTestTools,
    capabilityStatus
  }));

  const lifecycle = startup.add(createStudioWorldLifecycle({
    world:runtime.world,
    studioTools:runtime.studioTools,
    environmentDefinition,
    environmentMaterializer:runtime.environmentMaterializer,
    authoringWorlds:runtime.authoringWorlds,
    worldSurface:runtime.worldSurface,
    taskPanel:agent.taskPanel
  }));

  startup.add(await createStudioWorkspace({
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
  }));

  metrics.mark('workspace-ready');
  const publishedCode=params.get('codeWorld');
  const localCode=params.get('codeProject');
  const sharedCode=params.get('sharedCode');
  if(publishedCode || localCode || sharedCode){
    const { findPublishedCodeWorld } = await import('./code-project/PublishedCodeWorlds.js');
    const { parseCodeProject } = await import('../../application/native-scene/CodeProject.js');
    const controller=runtime.codeProjects;
    if(sharedCode){
      const existing=await controller.store.load(sharedCode);
      if(existing)await controller.load(sharedCode);
      else await controller.importShared(sharedCode);
      // Shared JavaScript is untrusted. Import to the editor without execution;
      // only the explicit "Run code world" action can execute it.
    }else if(publishedCode){
      const published=findPublishedCodeWorld(publishedCode);
      if(!published)throw new Error('CODE_WORLD_NOT_FOUND');
      await controller.refresh();
      if(controller.snapshot().projects.some(project=>project.id===published.id)){
        await controller.load(published.id);
      }else{
        const response=await fetch(published.projectUrl,{cache:'no-cache'});
        if(!response.ok)throw new Error('CODE_WORLD_DOWNLOAD_FAILED');
        const project=await parseCodeProject(await response.json());
        if(project.id!==published.id)throw new Error('CODE_WORLD_ID_MISMATCH');
        await controller.write({create:true,project});
      }
    }else{
      if(!/^world_[a-f0-9]{32}$/.test(localCode||''))throw new Error('CODE_PROJECT_ID_INVALID');
      await controller.load(localCode);
    }
    if(!sharedCode)await controller.run({expectedRevision:controller.snapshot().revision});
  }
  if (params.get('openCode') === '1') {
    const url = new URL(location.href);
    url.searchParams.set('page','world');
    url.searchParams.delete('openCode');
    history.replaceState(history.state,'',url.href);
    runtime.codeProjects.show();
  }
  window.addEventListener('pagehide',()=>startup.dispose(),{ once:true });
}

main().catch((error)=>{
  console.error(error);
  startup.dispose();
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
