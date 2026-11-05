import * as z from 'zod/v4';
const color = z.string().regex(/^#[a-fA-F0-9]{6}$/);
export const stylePackSchema = z.object({
  schema: z.literal('agentscape.style-pack'), schemaVersion: z.literal(1),
  id: z.string().regex(/^[A-Za-z][A-Za-z0-9_/-]{0,99}$/), version: z.string().regex(/^\d+\.\d+\.\d+$/),
  requires: z.array(z.string().min(1).max(64)).max(16).default([]),
  material: z.object({ mode: z.enum(['standard', 'toon', 'flat']), roughness: z.number().min(0).max(1).default(0.8), metalness: z.number().min(0).max(1).default(0), unsupported: z.enum(['preserve', 'reject']).default('reject') }).strict(),
  lighting: z.object({ ambient: z.number().min(0).max(5), directional: z.number().min(0).max(5) }).strict(),
  scene: z.object({ background: color, fog: z.object({ color, near: z.number().min(0).max(1000), far: z.number().positive().max(10000) }).strict().refine(f => f.far > f.near).optional() }).strict(),
  postprocessing: z.object({ exposure: z.number().min(0.1).max(4), toneMapping: z.enum(['aces', 'linear']), shadows: z.boolean() }).strict(),
  fallbackStyle: z.string().regex(/^builtin:\/\/[a-z-]+$/).optional()
}).strict();

const pack = (id, mode, background, exposure, ambient, directional) => ({ schema: 'agentscape.style-pack', schemaVersion: 1, id: `builtin/${id}`, version: '1.0.0',
  requires: [`material.${mode}`, 'renderer.exposure'], material: { mode, roughness: mode === 'flat' ? 1 : 0.75, metalness: 0, unsupported: 'preserve' },
  lighting: { ambient, directional }, scene: { background }, postprocessing: { exposure, toneMapping: 'aces', shadows: true } });
const freeze = value => { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };
export const officialStylePacks = freeze({
  realistic: pack('realistic', 'standard', '#dce5ef', 1.15, 1, 1.6),
  toon: pack('toon', 'toon', '#e3e7f5', 1.05, 1.4, 1.8),
  'low-poly': pack('low-poly', 'flat', '#cfded0', 1.1, 1.2, 1.4)
});
export function resolveStylePack(input) {
  if (typeof input !== 'string') {
    const parsed = stylePackSchema.parse(input);
    if (parsed.id.startsWith('builtin/')) {
      const official = officialStylePacks[parsed.id.slice(8)];
      if (!official || JSON.stringify(parsed) !== JSON.stringify(stylePackSchema.parse(official))) throw Object.assign(new Error('STYLE_ID_CONFLICT'), { code: 'STYLE_ID_CONFLICT' });
    }
    return parsed;
  }
  if (!input.startsWith('builtin://') || !officialStylePacks[input.slice(10)]) throw Object.assign(new Error('STYLE_UNAVAILABLE'), { code: 'STYLE_UNAVAILABLE' });
  return stylePackSchema.parse(structuredClone(officialStylePacks[input.slice(10)]));
}
