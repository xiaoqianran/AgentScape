import { WorldRuntime } from '../modules/world/runtime/WorldRuntime.js';
import { RenderingSystem } from '../modules/world/runtime/systems/RenderingSystem.js';
import { createAssetModule } from '../modules/asset/AssetModule.js';
import { attachGenerationRuntime } from './generation/GenerationRuntime.js';
import { SkillRegistry } from './skills/SkillRegistry.js';
import { registerCoreSkills } from './skills/registerCoreSkills.js';

// Composition only. DOM rendering is attached here; frame scheduling and input stay with the host.
export function createSession(container, {
  generation: generationOptions = {},
  rendererFactory = null,
  rendererMode = 'auto',
  rendererTiming = false,
  ...worldOptions
} = {}) {
  const world = new WorldRuntime({
    ...worldOptions,
    assetModule: worldOptions.assetModule || createAssetModule()
  });
  if (container) {
    const renderingOptions = {
      container,
      scene:world.scene,
      events:world.events,
      rendererMode,
      rendererTiming
    };
    if (rendererFactory) renderingOptions.rendererFactory = rendererFactory;
    world.attachRendering(new RenderingSystem(renderingOptions));
  }
  const generation = attachGenerationRuntime(world, generationOptions);
  world.skills = registerCoreSkills(new SkillRegistry({
    policy: world.policy, trace: world.trace, runtime: world
  }), world);
  return { world, generation };
}
