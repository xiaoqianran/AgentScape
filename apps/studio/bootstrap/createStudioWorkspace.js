import {
  authoringWorldUrl,
  builtInWorldUrl,
  generatedArtifactWorldUrl,
  parseStudioRoute
} from '../navigation/StudioRoutes.js';
import { createStudioContent } from './createStudioContent.js';
import { createStudioDeveloperTools } from './createStudioDeveloperTools.js';
import { activateStudioWorld } from './activateStudioWorld.js';

const currentHref = () => globalThis.location?.href || 'http://127.0.0.1/';

export async function createStudioWorkspace({
  ui,
  environmentDefinition,
  environments,
  capabilityStatus,
  world,
  authoringWorlds,
  studioTools,
  editor,
  worldSurface,
  taskPanel,
  gateway,
  lifecycle
}) {
  const enterEditor = (url,{ replace=false }={}) => {
    ui.setPage?.('world');
    const method=replace ? 'replaceState' : 'pushState';
    globalThis.history?.[method]?.(globalThis.history.state,'',url);
  };

  const openBuiltinWorld = async (id,{ historyMode='push' }={}) => {
    const result = await lifecycle.openBuiltinWorld(id);
    if (historyMode !== 'none') {
      enterEditor(builtInWorldUrl(currentHref(),id),{ replace:historyMode === 'replace' });
    }
    return result;
  };

  const openGeneratedWorld = async (artifactId,{ historyMode='push' }={}) => {
    const result = await lifecycle.openGeneratedWorld(artifactId);
    if (historyMode !== 'none') {
      enterEditor(generatedArtifactWorldUrl(currentHref(),artifactId),{ replace:historyMode === 'replace' });
    }
    return result;
  };

  const openAuthoringWorld = async (id,{ historyMode='push' }={}) => {
    const result = await lifecycle.worldOpener.open({ kind:'authoring', id });
    if (historyMode !== 'none') {
      enterEditor(authoringWorldUrl(currentHref(),id),{ replace:historyMode === 'replace' });
    }
    return result;
  };

  const newAuthoringWorld = async (options,{ historyMode='push' }={}) => {
    const result = await lifecycle.worldOpener.open({ kind:'authoring-new', options });
    if (historyMode !== 'none') {
      enterEditor(authoringWorldUrl(currentHref(),null),{ replace:historyMode === 'replace' });
    }
    return result;
  };

  ui.setWorldChangeHandler?.((id)=>openBuiltinWorld(id).catch((error)=>{
    taskPanel.log(`打开世界失败：${error.message}`,'error');
    throw error;
  }));

  const content = createStudioContent({
    ui,
    environmentDefinition,
    environments,
    world,
    authoring:authoringWorlds?.authoring || null,
    studioTools,
    editor,
    taskPanel,
    openBuiltinWorld,
    openGeneratedWorld
  });

  const developerTools = await createStudioDeveloperTools({
    ui,
    world,
    authoring:authoringWorlds?.authoring || null,
    studioTools,
    taskPanel,
    gateway,
    capabilityStatus
  });

  const activation = await activateStudioWorld({
    ui,
    world,
    authoringWorlds,
    editor,
    worldSurface,
    taskPanel,
    lifecycle,
    inspector:content.inspector,
    openAuthoringWorld,
    newAuthoringWorld
  });

  const applyWorldRoute = async () => {
    const route=parseStudioRoute(currentHref());
    if (route.page !== 'world') return;

    if (route.worldArtifactId) {
      if (lifecycle.worldSession.current?.persistenceSource !== 'artifact:' + route.worldArtifactId) {
        await openGeneratedWorld(route.worldArtifactId,{ historyMode:'none' });
      }
      return;
    }

    if (route.authoringId) {
      if (authoringWorlds?.status?.().id !== route.authoringId) {
        await openAuthoringWorld(route.authoringId,{ historyMode:'none' });
        await activation.authoringControls?.refresh?.();
      }
      return;
    }

    if (route.worldId && lifecycle.worldSession.current?.id !== route.worldId) {
      await openBuiltinWorld(route.worldId,{ historyMode:'none' });
    }
  };

  const handlePopState = () => {
    void applyWorldRoute().catch((error)=>taskPanel.log(`恢复世界路由失败：${error.message}`,'error'));
  };
  globalThis.window?.addEventListener?.('popstate',handlePopState);

  await applyWorldRoute().catch((error)=>{
    taskPanel.log(`恢复初始世界路由失败：${error.message}`,'error');
  });

  return {
    dispose() {
      globalThis.window?.removeEventListener?.('popstate',handlePopState);
      activation.dispose();
      developerTools.dispose();
      content.dispose();
    }
  };
}
