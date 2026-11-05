import * as z from 'zod/v4';
import { validateAssetManifest } from '../../modules/asset/model/schema.js';

export const proceduralContract='agentscape.procedural-asset.v1';
const id=z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/).refine(v=>!['__proto__','constructor','prototype'].includes(v));
const finite=z.number().finite().min(-100).max(100);
const vec=z.tuple([finite,finite,finite]);
const positive=z.number().min(.0001).max(50);
const actions=z.array(z.enum(['move','pickup','drop','place','open','close'])).max(8);
const collider=z.object({shape:z.enum(['box','cylinder','capsule','convexHull']),halfExtents:z.tuple([positive,positive,positive]).optional(),halfHeight:positive.optional(),radius:positive.optional(),translation:vec.optional(),rotation:z.tuple([finite,finite,finite,finite]).refine(q=>Math.abs(Math.hypot(...q)-1)<.0001).optional(),vertices:z.array(finite).max(768).optional()}).strict();
const physics=z.object({body:z.enum(['fixed','dynamic','kinematic']),mass:z.number().min(.0001).max(10000).optional(),friction:z.number().min(0).max(10).optional(),restitution:z.number().min(0).max(1).optional(),linearDamping:z.number().min(0).max(100).optional(),angularDamping:z.number().min(0).max(100).optional(),navigationObstacle:z.boolean().optional(),colliders:z.array(collider).min(1).max(32)}).strict();
const part=z.object({node:id,semantic:z.string().max(100).optional(),parent:id.optional(),actions,targets:z.record(z.enum(['open','close']),finite),physics,joint:z.object({type:z.enum(['revolute','prismatic','fixed']),axis:vec.optional(),limits:z.tuple([finite,finite]).optional(),parentAnchor:vec,childAnchor:vec,motor:z.object({stiffness:z.number().min(0).max(10000),damping:z.number().min(0).max(1000)}).strict().optional()}).strict()}).strict();
export const definitionSchema=z.object({id,type:id,label:z.string().min(1).max(100),description:z.string().max(500).optional(),tags:z.array(z.string().max(50)).max(20).optional(),aliases:z.array(z.string().max(50)).max(20).optional(),requiredNodes:z.array(id).max(64).optional(),actions,physics,parts:z.record(id,part).refine(v=>Object.keys(v).length<=16).optional(),surfaces:z.array(z.object({id,localPosition:vec,size:z.tuple([positive,positive])}).strict()).max(16).optional(),receptacles:z.array(z.object({id,localPosition:vec,size:z.tuple([positive,positive,positive])}).strict()).max(16).optional(),interactionContract:z.record(z.string(),z.unknown()).optional()}).strict();
export function parseDefinition(input) {
 let value;try{value=definitionSchema.parse(input);}catch{throw new Error('PROCEDURAL_MANIFEST_INVALID');}
 if(JSON.stringify(value).length>24576)throw new Error('PROCEDURAL_MANIFEST_LIMIT');
 if(new Set((value.surfaces||[]).map(s=>s.id)).size!==(value.surfaces||[]).length)throw new Error('PROCEDURAL_MANIFEST_INVALID');
 const safe=(v,depth=0)=>{if(depth>16)throw new Error('PROCEDURAL_MANIFEST_INVALID');if(!v||typeof v!=='object')return;for(const[k,item]of Object.entries(v)){if(['__proto__','constructor','prototype'].includes(k))throw new Error('PROCEDURAL_MANIFEST_INVALID');safe(item,depth+1);}};safe(value);
 try{validateAssetManifest({...value,source:{kind:'compiled',key:'pending'}});}catch{throw new Error('PROCEDURAL_MANIFEST_INVALID');}
 return value;
}
export function canonical(value) {if(value===null||typeof value!=='object')return JSON.stringify(value);if(Array.isArray(value))return `[${value.map(canonical).join(',')}]`;return `{${Object.keys(value).sort().map(k=>`${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;}
