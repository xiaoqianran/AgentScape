import { DeveloperSettings } from '../ui/developer/DeveloperSettings.js';
import { GenerationJobCenter } from '../ui/generation/GenerationJobCenter.js';
import { applyCapabilityStatus } from '../config/capabilityEntry.js';

export async function createStudioDeveloperTools({
  ui,
  world,
  studioTools,
  taskPanel,
  gateway,
  capabilityStatus
}) {
  const log = (text,kind)=>taskPanel.log(text,kind);
  let disposed = false;
  const developer = new DeveloperSettings({
    dialog:ui.developerDialog,
    world,
    tools:studioTools,
    gateway,
    initialCapabilityStatus:capabilityStatus,
    log,
    onCapabilityStatusChange:(status)=>{
      if (disposed) return;
      applyCapabilityStatus({ gateway, generation:world.generation },status);
      taskPanel.setAvailability(status.agent.available);
    }
  }).init();

  taskPanel.setOpenSettingsHandler(()=>developer.open());

  const openDeveloper = ()=>developer.open();
  ui.setDeveloperOpenHandler?.(openDeveloper);
  ui.setLayoutChangeHandler(()=>world.rendering?.resize?.());

  let generationJobCenter;
  try {
    generationJobCenter = await new GenerationJobCenter({
      root:ui.shell,
      world,
      tools:studioTools,
      log
    }).init();
  } catch (error) {
    ui.setDeveloperOpenHandler?.(null);
    ui.setLayoutChangeHandler?.(null);
    taskPanel.setOpenSettingsHandler?.(null);
    developer.dispose();
    throw error;
  }

  let refreshing = false;
  const refreshCapabilities = async () => {
    if (disposed || refreshing || globalThis.document?.visibilityState === 'hidden') return;
    refreshing = true;
    try { await developer.refreshCapabilityStatus(); }
    finally { refreshing = false; }
  };
  const queueRefresh = () => {
    refreshCapabilities().catch((error) => log(`能力状态刷新失败：${error.message}`, 'error'));
  };
  const timer = setInterval(queueRefresh, 30000);
  const onVisibilityChange = () => { queueRefresh(); };
  globalThis.document?.addEventListener?.('visibilitychange', onVisibilityChange);
  queueRefresh();

  return {
    developer,
    generationJobCenter,
    dispose() {
      disposed = true;
      clearInterval(timer);
      globalThis.document?.removeEventListener?.('visibilitychange', onVisibilityChange);
      ui.setDeveloperOpenHandler?.(null);
      ui.setLayoutChangeHandler?.(null);
      taskPanel.setOpenSettingsHandler?.(null);
      developer.dispose();
      generationJobCenter.destroy();
    }
  };
}
