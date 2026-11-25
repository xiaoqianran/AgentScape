import * as z from 'zod/v4';

const color=z.string().regex(/^#[a-fA-F0-9]{6}$/);
export const proceduralTextureSchema=z.object({
  pattern:z.enum(['wood','stone','fabric','brushed-metal']),
  seed:z.number().int().min(0).max(0xffffffff).default(0),
  resolution:z.union([z.literal(64),z.literal(128),z.literal(256)]).default(128),
  frequency:z.number().int().min(1).max(4).default(1),
  contrast:z.number().min(0).max(1).default(.6),
  normalStrength:z.number().min(0).max(1).default(.25),
  darkColor:color.optional(),
  lightColor:color.optional()
}).strict();

// Shared textures are counted once per recipe. The compiler embeds one color
// map and at most one normal map per declaration.
export const MAX_PROCEDURAL_TEXTURE_PIXELS=262144;

export const PROCEDURAL_TEXTURE_PALETTES=Object.freeze({
  wood:Object.freeze(['#775030','#cba06e']),
  stone:Object.freeze(['#65686a','#b8b7b1']),
  fabric:Object.freeze(['#77716c','#c4beb5']),
  'brushed-metal':Object.freeze(['#80868d','#d2d6d9'])
});
