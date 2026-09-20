import { WorldRuntime } from '../modules/world/runtime/WorldRuntime.js';
import { RenderingSystem } from '../modules/world/runtime/systems/RenderingSystem.js';
import { createAssetModule } from '../modules/asset/AssetModule.js';
import { attachGenerationRuntime } from './generation/GenerationRuntime.js';
import { SkillRegistry } from './skills/SkillRegistry.js';
import { registerCoreSkills } from './skills/registerCoreSkills.js';
import { createWorldAuthoringContext } from './createWorldAuthoringContext.js';
import { ArticulationVerifier } from '../modules/world/verification/ArticulationVerifier.js';
import { AuthoringPromotionController } from './world-authoring/AuthoringPromotionController.js';
import { createAuthoringAssetProducer } from './world-authoring/AuthoringAssetProducer.js';
import { registerAuthoringSkills } from './skills/packs/authoringSkills.js';

// Composition only. DOM rendering is attached here; frame scheduling and input stay with the host.
export function createSession(container, {
  generation: generationOptions = {},
  rendererFactory = null,
  rendererMode = 'auto',
  rendererTiming = false,
  articulationVerifier = null,
  ...worldOptions
} = {}) {
  const assetModule = worldOptions.assetModule || createAssetModule();
  assetModule.configureVerification({
    articulationVerifier:articulationVerifier || new ArticulationVerifier({
      assetRegistry:assetModule.registry,
      assetLoader:assetModule.loader,
      ...(worldOptions.physicsFactory ? { physicsFactory:worldOptions.physicsFactory } : {})
    })
  });
  const world = new WorldRuntime({
    ...worldOptions,
    assetModule
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
  const authoring = world.rendering ? createWorldAuthoringContext(world) : null;
  const promotion = authoring ? new AuthoringPromotionController({ authoring, world,
    produceAsset:createAuthoringAssetProducer({ assets:assetModule, artifacts:generation.artifacts }) }) : null;
  if (promotion) registerAuthoringSkills((name, options, handler) => world.skills.register({ name, ...options, handler }), promotion);
  return { world, generation, authoring, promotion };
}
