import { builtInWorldUrl } from '../ui/chrome/StudioChrome.js';
import { createStudioContent } from './createStudioContent.js';
import { createStudioDeveloperTools } from './createStudioDeveloperTools.js';
import { activateStudioWorld } from './activateStudioWorld.js';

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
  const openBuiltinWorld = async (id) => {
    const result = await lifecycle.openBuiltinWorld(id);
    globalThis.history?.replaceState?.(
      globalThis.history.state,
      '',
      builtInWorldUrl(location.href,id)
    );
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
    studioTools,
    editor,
    taskPanel,
    openBuiltinWorld,
    openGeneratedWorld:lifecycle.openGeneratedWorld
  });

  const developerTools = await createStudioDeveloperTools({
    ui,
    world,
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
    inspector:content.inspector
  });

  return {
    dispose() {
      activation.dispose();
      developerTools.dispose();
      content.dispose();
    }
  };
}
