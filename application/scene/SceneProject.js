import * as z from 'zod/v4';

export const sceneObjectIdSchema = z.string().regex(/^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/);
export const sceneVector3Schema = z.tuple([z.number().finite().min(-10000).max(10000), z.number().finite().min(-10000).max(10000), z.number().finite().min(-10000).max(10000)]);
const quaternionSchema = z.tuple([z.number().finite(), z.number().finite(), z.number().finite(), z.number().finite()])
  .refine(value => Math.abs(Math.hypot(...value) - 1) < 0.0001, 'Quaternion must be normalized');
const scaleSchema = z.number().finite().min(0.05).max(20);
export const sceneTransformSchema = z.object({
  position: sceneVector3Schema.default(() => [0, 0, 0]),
  quaternion: quaternionSchema.default(() => [0, 0, 0, 1]),
  scale: scaleSchema.default(1)
}).strict();
const builtinAssetSchema = z.string().regex(/^builtin:\/\/[a-zA-Z][a-zA-Z0-9_-]{0,63}$/);
// Portable package paths only. No URL decoding, drive paths, ADS or traversal.
export const sceneResourcePathSchema = z.string().max(240).refine(value => {
  if (!value.startsWith('./')) return false;
  return value.slice(2).split('/').every(part =>
    /^[a-zA-Z0-9_-][a-zA-Z0-9_.-]*$/.test(part) && !part.endsWith('.') &&
    !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part));
}, 'Expected a portable project-relative resource path');
export const sceneAssetRefSchema = z.union([builtinAssetSchema, z.string().regex(/^asset:\/\/sha256\/[a-f0-9]{64}$/), sceneResourcePathSchema]);
const sceneObjectSchema = z.object({
  id: sceneObjectIdSchema,
  asset: sceneAssetRefSchema,
  level: z.enum(['visual', 'physical', 'interactive']),
  transform: sceneTransformSchema.default(() => ({ position: [0, 0, 0], quaternion: [0, 0, 0, 1], scale: 1 }))
}).strict();
export const sceneProjectSchema = z.object({
  schema: z.literal('agentscape.scene-project'),
  schemaVersion: z.literal(1),
  name: z.string().trim().min(1).max(100),
  environment: z.object({ type: z.literal('builtin'), id: z.enum(['monument-hall','yuanmingyuan-western-mansions']) }).strict(),
  style: sceneAssetRefSchema.optional(),
  objects: z.array(sceneObjectSchema).max(32)
}).strict().superRefine((project, ctx) => {
  const used = new Set();
  for (let index = 0; index < project.objects.length; index++) {
    const id = project.objects[index].id;
    if (used.has(id)) ctx.addIssue({ code: 'custom', path: ['objects', index, 'id'], message: 'Duplicate scene object ID' });
    used.add(id);
  }
});

export function parseSceneProject(input) {
  if (typeof input === 'string') {
    if (new TextEncoder().encode(input).byteLength > 256 * 1024) throw projectError('DOCUMENT_LIMIT');
    try { input = JSON.parse(input); } catch { throw projectError('INVALID_DOCUMENT'); }
  }
  if (input?.schema === 'agentscape.scene-project' && input.schemaVersion !== 1) throw projectError('UNSUPPORTED_VERSION');
  const result = sceneProjectSchema.safeParse(input);
  if (!result.success) throw projectError('INVALID_DOCUMENT', result.error.issues.map(issue => ({ path: issue.path, message: issue.message })));
  return result.data;
}

function projectError(code, diagnostics = []) {
  return Object.assign(new Error(code), { code, diagnostics });
}

/** Resolve an already extracted, bounded package of bytes. Never opens host files or URLs.
 * Filesystem/archive adapters must reject links before constructing this Map.
 * This is dependency resolution only, not asset admission or Runtime installation.
 */
export async function resolveSceneProject(input, { resources = new Map(), builtins = new Map() } = {}) {
  const project = parseSceneProject(input);
  if (!(resources instanceof Map) || !(builtins instanceof Map) || resources.size > 128) throw projectError('INVALID_RESOURCES');
  let total = 0;
  const names = new Set();
  const bytes = new Map();
  for (const [path, value] of resources) {
    if (!sceneResourcePathSchema.safeParse(path).success || names.has(path.toLowerCase())) throw projectError('INVALID_RESOURCE_PATH');
    names.add(path.toLowerCase());
    if (!(value instanceof Uint8Array)) throw projectError('INVALID_RESOURCES');
    total += value.byteLength;
    if (value.byteLength > 32 * 1024 * 1024 || total > 64 * 1024 * 1024) throw projectError('RESOURCE_LIMIT');
    bytes.set(path, value.slice());
  }
  const refs = new Set([`builtin://${project.environment.id}`, ...project.objects.map(object => object.asset), ...(project.style ? [project.style] : [])]);
  const dependencies = [];
  for (const ref of refs) {
    let sha256;
    if (ref.startsWith('builtin://') || ref.startsWith('asset://')) {
      // The host supplies hashes from its versioned built-in resource catalog.
      sha256 = builtins.get(ref);
      if (!/^[a-f0-9]{64}$/.test(sha256 ?? '')) throw projectError('RESOURCE_UNAVAILABLE');
    } else {
      const data = bytes.get(ref);
      if (!data) throw projectError('RESOURCE_UNAVAILABLE');
      const digest = await globalThis.crypto.subtle.digest('SHA-256', data);
      sha256 = Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, '0')).join('');
    }
    dependencies.push({ ref, sha256 });
  }
  return { project, dependencies };
}
