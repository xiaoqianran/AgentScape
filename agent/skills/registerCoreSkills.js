import { registerAssetSkills } from './packs/assetSkills.js';
import { registerGenerationSkills } from './packs/generationSkills.js';
import { registerSceneSkills } from './packs/sceneSkills.js';
import { registerSpatialSkills } from './packs/spatialSkills.js';
import { registerInteractionSkills } from './packs/interactionSkills.js';
import { registerAcceptanceSkills } from './packs/acceptanceSkills.js';
import { registerRecoverySkills } from './packs/recoverySkills.js';
import { registerVerificationSkills } from './packs/verificationSkills.js';
import { registerBatchSkills } from './packs/batchSkills.js';
import { registerWorldSkills } from './packs/worldSkills.js';

export function registerCoreSkills(registry,runtime) {
  const add=(name,options,handler)=>registry.register({name,...options,handler});
  registerAssetSkills(add,runtime);
  registerGenerationSkills(add,runtime);
  registerSceneSkills(add,runtime);
  registerSpatialSkills(add,runtime);
  registerInteractionSkills(add,runtime);
  registerAcceptanceSkills(add,runtime);
  registerRecoverySkills(add,runtime);
  registerVerificationSkills(add,runtime);
  registerBatchSkills(add,runtime,registry);
  registerWorldSkills(add,runtime);
  return registry;
}
