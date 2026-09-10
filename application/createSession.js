import { WorldRuntime } from '../modules/world/runtime/WorldRuntime.js';
import { createAssetModule } from '../modules/asset/AssetModule.js';
import { attachGenerationRuntime } from './generation/GenerationRuntime.js';
import { SkillRegistry } from './skills/SkillRegistry.js';
import { registerCoreSkills } from './skills/registerCoreSkills.js';

// Composition only. DOM input, frame scheduling and UI lifecycle belong to the host.
export function createSession(container, { generation: generationOptions = {}, ...worldOptions } = {}) {
  const world = new WorldRuntime(container, {
    ...worldOptions,
    assetModule: worldOptions.assetModule || createAssetModule()
  });
  const generation = attachGenerationRuntime(world, generationOptions);
  world.skills = registerCoreSkills(new SkillRegistry({
    policy: world.policy, trace: world.trace, runtime: world
  }), world);
  return { world, generation };
}
