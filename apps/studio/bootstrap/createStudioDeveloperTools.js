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
  const developer = new DeveloperSettings({
    dialog:ui.developerDialog,
    world,
    tools:studioTools,
    gateway,
    initialCapabilityStatus:capabilityStatus,
    log,
    onCapabilityStatusChange:(status)=>{
      applyCapabilityStatus({ gateway, generation:world.generation },status);
      taskPanel.setAvailability(status.agent.available);
    }
  }).init();

  taskPanel.setOpenSettingsHandler(()=>developer.open());

  const openDeveloper = ()=>developer.open();
  ui.setDeveloperOpenHandler?.(openDeveloper);
  ui.setLayoutChangeHandler(()=>world.rendering?.resize?.());

  const generationJobCenter = await new GenerationJobCenter({
    root:ui.panel,
    world,
    tools:studioTools,
    log
  }).init();

  return {
    developer,
    generationJobCenter,
    dispose() {
      ui.setDeveloperOpenHandler?.(null);
      generationJobCenter.destroy();
    }
  };
}
