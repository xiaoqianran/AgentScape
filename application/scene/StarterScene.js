import * as z from 'zod/v4';
import { WorldRuntime } from '../../modules/world/runtime/WorldRuntime.js';
import { RenderingSystem } from '../../modules/world/runtime/systems/RenderingSystem.js';
import { createMonumentHall } from '../../modules/world/content/monumentHall.js';
import { createAssetModule } from '../../modules/asset/AssetModule.js';
import { assetManifests } from '../../modules/asset/registry/manifests/index.js';
import { SkillRegistry } from '../skills/SkillRegistry.js';
import { registerSceneSkills } from '../skills/packs/sceneSkills.js';
import { registerSpatialSkills } from '../skills/packs/spatialSkills.js';
import { registerInteractionSkills } from '../skills/packs/interactionSkills.js';
import { AgentTools } from '../AgentTools.js';

// Experimental, local-only entry. It deliberately does not implement the whole v1 RFC.
const id = z.string().regex(/^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/);
const position = z.tuple([z.number().finite().min(-12).max(12), z.number().finite().min(0).max(8), z.number().finite().min(-10).max(10)]);
const asset = z.enum(['agent', 'cup', 'table', 'chair']);
const object = z.object({ id, asset, position }).strict();
export const starterProjectSchema = z.object({
  schema: z.literal('agentscape.starter-project'),
  schemaVersion: z.literal(1),
  name: z.string().min(1).max(100),
  objects: z.array(object).max(32)
}).strict().refine(p => new Set(p.objects.map(o => o.id)).size === p.objects.length, 'Duplicate object ID');
const interaction = z.discriminatedUnion('action', [
  z.object({ action: z.literal('pickup'), actorId: id, targetId: id }).strict(),
  z.object({ action: z.literal('place'), actorId: id, targetId: id, surfaceId: id.optional() }).strict(),
  z.object({ action: z.literal('navigate'), actorId: id, position }).strict()
]);
const fail = (code, message = code) => Object.assign(new Error(message), { code });

/** Open a small, offline world using the existing runtime. No AI/provider or code execution. */
export async function openStarterScene({ project, container = null } = {}) {
  const definition = starterProjectSchema.parse(project);
  const manifests = Object.fromEntries(['agent', 'cup', 'table', 'chair'].map(key => [key, structuredClone(assetManifests[key])]));
  const world = new WorldRuntime({
    assetModule: createAssetModule({ manifests, manifestStore: null, libraryStore: null }),
    environmentFactory: () => createMonumentHall({ loadAssets: false })
  });
  if (container) world.attachRendering(new RenderingSystem({ container, scene: world.scene, events: world.events, rendererMode: 'webgl' }));
  world.skills = new SkillRegistry({ policy: world.policy, trace: world.trace, runtime: world });
  const add = (name, options, handler) => world.skills.register({ name, ...options, handler });
  registerSceneSkills(add, world);
  registerSpatialSkills(add, world);
  registerInteractionSkills(add, world);
  const tools = new AgentTools(world, { profile: 'builder', source: 'starter' });
  let busy = false;
  let closed = false;
  const assertOpen = () => { if (closed) throw fail('SCENE_CLOSED'); };
  const exclusive = async operation => {
    assertOpen();
    if (busy) throw fail('SCENE_BUSY', 'Wait for the current operation to finish.');
    busy = true;
    try { return await operation(); } finally { busy = false; }
  };
  const call = async (skill, args) => {
    const result = await tools.call(skill, args);
    return { ...tools.executionPolicy(skill, result).outcome, result };
  };
  try {
    await world.init();
    for (const entry of definition.objects) {
      await tools.call('spawnAsset', { assetId: entry.asset, instanceId: entry.id, position: entry.position });
    }
    world.rendering?.applyCameraState({ position: [10, 10, 16], target: [0, 0.8, 3] });
    world.simulation.play();
  } catch (error) {
    // init can fail before a SceneGraph exists.
    if (world.sceneGraph) world.dispose();
    else { world.rendering?.dispose(); world.physics.dispose(); }
    throw error;
  }
  return {
    observe() {
      assertOpen();
      world.sceneGraph.update();
      return {
        objects: world.store.list().map(([key, record]) => ({
          ...world.observation.object(key), state: structuredClone(record.state),
          physicsRegistered: Boolean(world.physics.getPosition(key))
        })),
        relations: structuredClone(world.sceneGraph.list())
      };
    },
    add(input) {
      return exclusive(() => {
        const entry = object.parse(input);
        if (world.store.list().length >= 32) throw fail('OBJECT_LIMIT');
        return call('spawnAsset', { assetId: entry.asset, instanceId: entry.id, position: entry.position });
      });
    },
    move(input) {
      return exclusive(() => {
        const args = z.object({ id, position }).strict().parse(input);
        if (world.store.get(args.id)?.state?.heldBy) throw fail('OBJECT_HELD');
        return call('moveObject', args);
      });
    },
    interact(input) {
      return exclusive(() => {
        const args = interaction.parse(input);
        if (args.action === 'navigate') return call('navigateTo', { id: args.actorId, end: args.position });
        if (args.action === 'pickup') return call('approachAndPickup', { actorId: args.actorId, targetId: args.targetId });
        return call('approachAndPlace', { actorId: args.actorId, supportId: args.targetId, ...(args.surfaceId ? { surfaceId: args.surfaceId } : {}) });
      });
    },
    save() {
      assertOpen();
      if (busy) throw fail('SCENE_BUSY');
      return world.serialize({ name: definition.name });
    },
    load(snapshot) {
      return exclusive(async () => {
        // This local starter restores only its bundled assets and ordinary runtime state.
        // It is not a general remote import endpoint or asset package loader.
        const copy = structuredClone(snapshot);
        if (JSON.stringify(copy).length > 256 * 1024) throw fail('SAVE_LIMIT');
        world.serializer.validate(copy);
        if (copy.objects.length > 32 || copy.assets.length || copy.configuration?.behaviorBundle || copy.configuration?.physicsRequirements || copy.metadata?.environmentState || copy.metadata?.worldRevision) throw fail('UNSUPPORTED_SAVE');
        for (const entry of copy.objects) { id.parse(entry.id); asset.parse(entry.assetId); }
        if (copy.camera) {
          const vector = z.tuple([z.number().finite(), z.number().finite(), z.number().finite()]);
          z.object({ position: vector, target: vector }).strict().parse(copy.camera);
        }
        await world.restore(copy);
        return { status: 'restored', objects: copy.objects.length };
      });
    },
    // Hosts own scheduling: browser requestAnimationFrame or deterministic headless steps.
    frame(timestamp) { assertOpen(); world.simulation.pump(timestamp); world.rendering?.render(timestamp); },
    step() { assertOpen(); return world.simulation.step(); },
    close() {
      if (closed) return;
      if (busy) throw fail('SCENE_BUSY');
      closed = true;
      world.dispose();
    }
  };
}
