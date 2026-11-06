import * as z from 'zod/v4';
import { openScene } from './SceneFacade.js';

// Experimental, local-only entry. It deliberately does not implement the whole v1 RFC.
const id = z.string().regex(/^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/);
const position = z.tuple([z.number().finite().min(-12).max(12), z.number().finite().min(0).max(8), z.number().finite().min(-10).max(10)]);
const asset = z.enum(['agent', 'cup', 'table', 'chair']);
const object = z.object({ id, asset, position }).strict();
export const starterProjectSchema = z.object({
  schema: z.literal('agentscape.starter-project'),
  schemaVersion: z.literal(1),
  name: z.string().min(1).max(100),
  objects: z.array(object)
}).strict().refine(p => new Set(p.objects.map(o => o.id)).size === p.objects.length, 'Duplicate object ID');
const interaction = z.discriminatedUnion('action', [
  z.object({ action: z.literal('pickup'), actorId: id, targetId: id }).strict(),
  z.object({ action: z.literal('place'), actorId: id, targetId: id, surfaceId: id.optional() }).strict(),
  z.object({ action: z.literal('navigate'), actorId: id, position }).strict()
]);
const fail = (code, message = code) => Object.assign(new Error(message), { code });

/** Legacy Starter adapter. All state and operations belong to SceneFacade. */
export async function openStarterScene({ project, container = null } = {}) {
  const definition = starterProjectSchema.parse(project);
  const scene = await openScene({ container, project: {
    schema: 'agentscape.scene-project', schemaVersion: 1, name: definition.name,
    environment: { type: 'builtin', id: 'monument-hall' },
    objects: definition.objects.map(entry => ({ id: entry.id, asset: 'builtin://' + entry.asset, level: 'physical', transform: { position: entry.position } }))
  } });
  return {
    observe: () => scene.observe(),
    async add(input) { const entry = object.parse(input); return scene.addModel({ ...entry, asset: 'builtin://' + entry.asset }); },
    async move(input) { const args = z.object({ id, position }).strict().parse(input); return scene.setTransform({ id: args.id, transform: { position: args.position } }); },
    async interact(input) {
      const args = interaction.parse(input);
      const job = scene.interact({ action: args.action, actor: args.actorId,
        ...(args.action === 'navigate' ? { position: args.position } : { target: args.targetId }),
        ...(args.surfaceId ? { surfaceId: args.surfaceId } : {}) });
      const { result } = await scene.waitJob(job.id);
      if (result.diagnostics.length) throw fail(result.diagnostics[0].code);
      return { ...result.outcome, verified: result.verification.status === 'verified', result: result.value };
    },
    save: () => scene.snapshot(),
    async load(snapshot) {
      const copy = structuredClone(snapshot);
      if (JSON.stringify(copy).length > 256 * 1024) throw fail('SAVE_LIMIT');
      if (copy.camera) {
        const vector = z.tuple([z.number().finite(), z.number().finite(), z.number().finite()]);
        z.object({ position: vector, target: vector }).strict().parse(copy.camera);
      }
      for (const entry of copy.objects || []) { id.parse(entry.id); asset.parse(entry.assetId); }
      return (await scene.restoreSnapshot(copy)).value;
    },
    frame: timestamp => scene.frame(timestamp), step: () => scene.step(), close: () => scene.close()
  };
}
