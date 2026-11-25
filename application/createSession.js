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
  rendererPixelRatioScale = 1,
  articulationVerifier = null,
  authoringOptions = null,
  codeExecutor = null,
  codeGLTFLoader = undefined,
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
      rendererTiming,
      pixelRatioScale:rendererPixelRatioScale
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
  const scene = createSceneFacade(world, { codeExecutor, codeGLTFLoader });
  world.skills.register({ name:'addSceneModel', description:'通过 Scene API 添加已有 AssetRef 或低多边形声明式 Asset Recipe（最多64个部件，支持 box/perforated-box/sphere/ellipsoid/cylinder/tapered-cylinder/segment；perforated-box 用局部 XZ 孔中心与半径生成贯穿 Y 的实体孔）。适合简单物体和占位；复杂自然造型、繁密树叶和动画请使用 Studio 代码项目。Recipe 不执行 JavaScript，物理/交互能力需显式声明。返回添加、准入和验证三个独立结果。', permissions:['world.write','asset.write'], required:['model'], properties:{model:z.toJSONSchema(sceneAgentModelSchema)}, mutates:true, manualMutation:true, batchable:false,
    handler:({model})=>scene.addModel(sceneAgentModelSchema.parse(model)) });
  return { world, generation, authoring, promotion, scene };
}
