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
import { registerCodeSkills } from './skills/packs/codeSkills.js';
import { createSceneFacade, sceneAgentModelSchema } from './scene/SceneFacade.js';
import * as z from 'zod/v4';

// Composition only. DOM rendering is attached here; frame scheduling and input stay with the host.
export function createSession(container, {
  generation: generationOptions = {},
  rendererFactory = null,
  rendererMode = 'auto',
  rendererTiming = false,
  articulationVerifier = null,
  authoringOptions = null,
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
  const authoring = world.rendering || authoringOptions ? createWorldAuthoringContext(world, authoringOptions || {}) : null;
  const promotion = authoring ? new AuthoringPromotionController({ authoring, world,
    produceAsset:createAuthoringAssetProducer({ assets:assetModule, artifacts:generation.artifacts }) }) : null;
  if (promotion) registerAuthoringSkills((name, options, handler) => world.skills.register({ name, ...options, handler }), promotion);
  if (authoring) registerCodeSkills((name, options, handler) => world.skills.register({ name, ...options, handler }), authoring);
  const scene = createSceneFacade(world);
  world.skills.register({ name:'addSceneModel', description:'通过 Scene API 添加已有 AssetRef 或声明式 Asset Recipe。基础几何用 Recipe JSON，不生成或执行 JavaScript。返回添加、准入和验证三个独立结果。', permissions:['world.write','asset.write'], required:['model'], properties:{model:z.toJSONSchema(sceneAgentModelSchema)}, mutates:true, manualMutation:true, batchable:false,
    handler:({model})=>scene.addModel(sceneAgentModelSchema.parse(model)) });
  world.skills.register({ name:'verifyScene', description:'使用真实 Runtime 检查显式后置条件；不把添加成功当成动作验证。', permissions:['world.read','physics.read'], required:['criteria'], properties:{criteria:{type:'array',minItems:1,maxItems:32}}, mutates:false,
    handler:({criteria})=>{ if(!Array.isArray(criteria)||!criteria.length||criteria.length>32) throw new Error('INVALID_CRITERIA'); return scene.verify(criteria).value; } });
  return { world, generation, authoring, promotion, scene };
}
