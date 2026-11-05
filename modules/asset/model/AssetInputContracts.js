import * as z from 'zod/v4';

const number = z.number().finite().min(-100).max(100);
const size = z.number().finite().positive().max(100);
const vector = z.tuple([number, number, number]);
const sizes = z.tuple([size, size, size]);
const id = z.string().regex(/^[A-Za-z][A-Za-z0-9_-]{0,63}$/);
export const packagePath = z.string().max(240).refine(value => value.startsWith('./') && value.slice(2).split('/').every(p => /^[A-Za-z0-9_-][A-Za-z0-9_.-]*$/.test(p) && !p.endsWith('.') && !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(p)));
const boxCollider = z.object({ shape: z.literal('box'), halfExtents: sizes, translation: vector.default(() => [0, 0, 0]) }).strict();
const physics = z.object({ body: z.enum(['fixed', 'dynamic']), mass: size.default(1), friction: z.number().min(0).max(2).default(0.5), colliders: z.array(boxCollider).min(1).max(64) }).strict();
const reviewedPhysics = z.object({ body:z.enum(['fixed','dynamic']), mass:size, friction:z.number().min(0).max(2),
  colliders:z.array(boxCollider).max(64).optional() }).strict();
export const interactionReviewSchema = z.object({
  proposalId:z.string().regex(/^[a-f0-9]{64}$/), confirmed:z.literal(true), physics:reviewedPhysics,
  parts:z.array(z.object({ id, node:z.string().min(1).max(128), parent:z.string().min(1).max(64).default('$root'),
    physics:reviewedPhysics.refine(value=>value.body==='dynamic','Moving parts require dynamic bodies'),
    joint:z.object({ type:z.enum(['prismatic','revolute']), axis:vector.refine(value=>Math.hypot(...value)>1e-6),
      parentAnchor:vector, childAnchor:vector, limits:z.tuple([number,number]).refine(([a,b])=>a<b && a<=0 && b>=0,'Limits must contain the GLB rest-zero pose'),
      motor:z.object({stiffness:z.number().positive().max(1000),damping:z.number().positive().max(100)}).strict().default(()=>({stiffness:80,damping:12}))
    }).strict()
  }).strict()).max(32).default([])
}).strict().refine(value=>new Set(value.parts.map(part=>part.id)).size===value.parts.length && new Set(value.parts.map(part=>part.node)).size===value.parts.length,'Duplicate part id or node');
export const glbInputSchema = z.object({kind:z.literal('glb'),bytes:z.instanceof(Uint8Array),name:z.string().min(1).max(128).optional(),urdfBytes:z.instanceof(Uint8Array).optional(),review:interactionReviewSchema.optional()}).strict();
export const recipeSchema = z.object({
  schema: z.literal('agentscape.asset-recipe'), schemaVersion: z.literal(1),
  id: z.string().regex(/^[A-Za-z][A-Za-z0-9_-]*(\/[A-Za-z][A-Za-z0-9_-]*)?$/).max(100),
  parts: z.array(z.object({ id, parent: id.optional(), geometry: z.discriminatedUnion('type', [
    z.object({ type: z.literal('box'), size: sizes }).strict(),
    z.object({ type: z.literal('sphere'), radius: size }).strict(),
    z.object({ type: z.literal('cylinder'), radius: size, height: size }).strict()
  ]).optional(), position: vector.default(() => [0, 0, 0]),
    quaternion: z.tuple([number, number, number, number]).refine(q => Math.abs(Math.hypot(...q) - 1) < 0.0001).default(() => [0, 0, 0, 1]),
    scale: z.number().min(0.05).max(20).default(1),
    material: z.object({ color: z.string().regex(/^#[a-fA-F0-9]{6}$/).default('#aaaaaa'), roughness: z.number().min(0).max(1).default(0.7), metalness: z.number().min(0).max(1).default(0) }).strict().optional()
  }).strict()).min(1).max(64),
  capabilities: z.object({ level: z.enum(['visual', 'physical', 'interactive']), physics: physics.optional(),
    actions: z.array(z.enum(['move', 'pickup', 'place'])).max(3).default([]),
    surfaces: z.array(z.object({ id, localPosition: vector, size: z.tuple([size, size]) }).strict()).max(16).default([])
  }).strict().default(() => ({ level: 'visual', actions: [], surfaces: [] }))
}).strict().superRefine((recipe, ctx) => {
  const issue = message => ctx.addIssue({ code: 'custom', message });
  const parts = new Map(recipe.parts.map(p => [p.id, p]));
  if (parts.size !== recipe.parts.length) issue('Duplicate part ID');
  for (const part of recipe.parts) {
    const seen = new Set([part.id]); let parent = part.parent;
    while (parent) {
      if (!parts.has(parent) || seen.has(parent) || seen.size >= 4) { issue('Invalid parent, cycle or hierarchy depth'); break; }
      seen.add(parent); parent = parts.get(parent).parent;
    }
  }
  const c = recipe.capabilities;
  if (c.level === 'visual' && (c.physics || c.actions.length || c.surfaces.length)) issue('Visual cannot declare physical behavior');
  if (c.level !== 'visual' && !c.physics) issue('Physical capabilities require explicit physics');
  if (c.level === 'interactive' && !c.actions.length) issue('Interactive requires declared actions');
  if (c.actions.includes('pickup') && c.physics?.body !== 'dynamic') issue('Pickup requires a dynamic body');
  if (new Set(c.actions).size !== c.actions.length || new Set(c.surfaces.map(s => s.id)).size !== c.surfaces.length) issue('Duplicate capability ID');
});

export const assetPackageSchema = z.object({
  schema: z.literal('agentscape.asset-package'), schemaVersion: z.literal(1),
  id: z.string().min(1).max(100), version: z.string().regex(/^\d+\.\d+\.\d+$/),
  entry: z.object({ kind: z.enum(['glb', 'recipe', 'procedural']), path: packagePath }).strict(),
  level: z.enum(['visual', 'physical', 'interactive']),
  dependencies: z.array(z.object({ path: packagePath, sha256: z.string().regex(/^[a-f0-9]{64}$/) }).strict()).max(128).default([])
}).strict().refine(p => new Set(p.dependencies.map(d => d.path.toLowerCase())).size === p.dependencies.length, 'Duplicate dependency path');

export const canonicalAssetJson = value => value === null || typeof value !== 'object' ? JSON.stringify(value) : Array.isArray(value) ? `[${value.map(canonicalAssetJson).join(',')}]` : `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonicalAssetJson(value[k])}`).join(',')}}`;
export async function assetDigest(bytes) { return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), b => b.toString(16).padStart(2, '0')).join(''); }

/** Reject external glTF resources before any loader or compiler can fetch them. */
export function assertEmbeddedGLB(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length < 20 || bytes.length > 32 * 1024 * 1024) throw new Error('ASSET_INPUT_INVALID');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, true) !== 0x46546c67 || view.getUint32(4, true) !== 2 || view.getUint32(8, true) !== bytes.length || view.getUint32(16, true) !== 0x4e4f534a) throw new Error('INVALID_GLB');
  const length = view.getUint32(12, true);
  if (length > bytes.length - 20) throw new Error('INVALID_GLB');
  const document = JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + length)).trim());
  if ([...(document.buffers || []), ...(document.images || [])].some(item => item.uri != null)) throw new Error('EXTERNAL_RESOURCE_FORBIDDEN');
  if ((document.nodes?.length || 0) > 256) throw new Error('ASSET_NODE_LIMIT');
  const parents = new Set();
  for (const node of document.nodes || []) for (const child of node.children || []) {
    if (!Number.isInteger(child) || child < 0 || parents.has(child)) throw new Error('INVALID_NODE_HIERARCHY');
    parents.add(child);
  }
  const visit = (index, ancestors = new Set()) => {
    if (ancestors.has(index) || ancestors.size > 16 || !document.nodes?.[index]) throw new Error('INVALID_NODE_HIERARCHY');
    const next = new Set(ancestors).add(index);
    for (const child of document.nodes[index].children || []) visit(child, next);
  };
  for (let i = 0; i < (document.nodes?.length || 0); i++) visit(i);
  return document;
}
