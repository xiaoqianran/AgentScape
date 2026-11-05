import * as z from 'zod/v4';
import { recipeSchema } from './AssetInputContracts.js';

// Declarative, bounded source of truth for user-authored mechanical assets.
// It is not a JavaScript execution surface and never accepts runtime verification claims.
const finite = z.number().finite().min(-100).max(100);
const positive = z.number().finite().positive().max(100);
const vec3 = z.tuple([finite, finite, finite]);
const componentId = z.string().regex(/^[A-Za-z][A-Za-z0-9_-]{0,63}$/);
const component = z.object({
  id:componentId,
  parent:componentId.nullable().default(null),
  shape:z.enum(['group','box','sphere','cylinder']),
  position:vec3,
  size:z.tuple([positive,positive,positive]),
  color:z.string().regex(/^#[a-fA-F0-9]{6}$/),
  collision:z.boolean().default(true)
}).strict().superRefine((node,ctx)=>{
  if(node.shape==='sphere' && (node.size[0]!==node.size[1] || node.size[0]!==node.size[2]))
    ctx.addIssue({code:'custom',message:'Sphere dimensions must match on X, Y and Z'});
  if(node.shape==='cylinder' && node.size[0]!==node.size[2])
    ctx.addIssue({code:'custom',message:'Cylinder diameter must match on X and Z'});
});
const motion = z.object({
  id:componentId,
  node:componentId,
  type:z.enum(['revolute','prismatic']),
  axis:vec3.refine(v=>Math.hypot(...v)>1e-6),
  limits:z.tuple([finite,finite]).refine(([a,b])=>a<b && a<=0 && b>=0),
  open:finite,
  mass:positive,
  friction:z.number().min(0).max(2).default(.6),
  stiffness:z.number().positive().max(1000).default(80),
  damping:z.number().positive().max(100).default(12)
}).strict().refine(m=>m.open>=m.limits[0] && m.open<=m.limits[1] && m.open!==0,'Open target must be inside limits and differ from zero');

export const mechanicalDraftSchema = z.object({
  schema:z.literal('agentscape.mechanical-draft'),
  schemaVersion:z.literal(1),
  name:z.string().trim().min(2).max(80),
  type:componentId.default('mechanism'),
  components:z.array(component).min(1).max(64),
  motions:z.array(motion).max(12)
}).strict().superRefine((draft,ctx)=>{
  const components=new Map(draft.components.map(node=>[node.id,node]));
  if(components.size!==draft.components.length)ctx.addIssue({code:'custom',message:'Component names must be unique'});
  const ids=new Set();
  const nodes=new Set();
  for(const entry of draft.motions) {
    if(ids.has(entry.id)||nodes.has(entry.node))ctx.addIssue({code:'custom',message:'Joint id and node must be unique'});
    ids.add(entry.id);nodes.add(entry.node);
    if(!components.has(entry.node)||components.get(entry.node).shape!=='group'||components.get(entry.node).parent) {
      ctx.addIssue({code:'custom',message:'A joint must reference a root-level group pivot: '+entry.node});
    }
  }
  for(const entry of draft.components) {
    if(entry.shape==='group' && !nodes.has(entry.id))ctx.addIssue({code:'custom',message:'Group must be a named joint pivot: '+entry.id});
    if(entry.parent && (!nodes.has(entry.parent)||components.get(entry.parent)?.shape!=='group'))ctx.addIssue({code:'custom',message:'Parent must be a joint pivot: '+entry.id});
    if(entry.parent===entry.id)ctx.addIssue({code:'custom',message:'Component cannot parent itself'});
  }
  if(!draft.components.some(part=>part.collision && !part.parent && part.shape!=='group'))ctx.addIssue({code:'custom',message:'At least one fixed-body collision component is required'});
  for(const joint of draft.motions) {
    if(!draft.components.some(part=>part.parent===joint.node && part.collision && part.shape!=='group'))ctx.addIssue({code:'custom',message:'Joint requires a collision component: '+joint.id});
  }
});

const collider = node => ({
  shape:'box',
  halfExtents: node.shape==='sphere' ? [node.size[0]/2,node.size[0]/2,node.size[0]/2]
    : node.shape==='cylinder' ? [node.size[0]/2,node.size[1]/2,node.size[0]/2]
    : node.size.map(size=>size/2),
  translation:[...node.position]
});

export function mechanicalDraftToAssetRecipe(input) {
  const draft=mechanicalDraftSchema.parse(input);
  return recipeSchema.parse({
    schema:'agentscape.asset-recipe',schemaVersion:1,id:'mechanical/'+draft.type,
    parts:draft.components.map(node=>({
      id:node.id,
      ...(node.parent?{parent:node.parent}:{}),
      ...(node.shape==='group'?{}: {geometry: node.shape==='box'
        ? {type:'box',size:[...node.size]}
        : node.shape==='sphere'?{type:'sphere',radius:node.size[0]/2}
        : {type:'cylinder',radius:node.size[0]/2,height:node.size[1]}}),
      position:[...node.position],
      material:{color:node.color,roughness:.48,metalness:.6}
    }))
  });
}

export function mechanicalDraftToManifest(input) {
  const draft=mechanicalDraftSchema.parse(input);
  const rootColliders=draft.components.filter(node=>node.collision&&!node.parent&&node.shape!=='group').map(collider);
  const parts={};
  for(const motion of draft.motions) {
    const pivot=draft.components.find(node=>node.id===motion.node);
    parts[motion.id]={
      node:motion.node,
      actions:['open','close'],
      targets:{open:motion.open,close:0},
      physics:{
        body:'dynamic',mass:motion.mass,friction:motion.friction,
        colliders:draft.components.filter(node=>node.parent===motion.node&&node.collision&&node.shape!=='group').map(collider)
      },
      joint:{
        type:motion.type,axis:[...motion.axis],limits:[...motion.limits],
        parentAnchor:[...pivot.position],childAnchor:[0,0,0],
        motor:{stiffness:motion.stiffness,damping:motion.damping}
      }
    };
  }
  return {
    type:draft.type,label:draft.name,
    capabilityLevel:draft.motions.length?'interactive':'physical',
    actions:draft.motions.length?['open','close']:['move'],
    requiredNodes:draft.motions.map(m=>m.node),
    physics:{body:'fixed',mass:1,friction:.6,colliders:rootColliders},
    ...(draft.motions.length?{parts}:{})
  };
}

const item=(id,shape,position,size,color,parent=null,collision=true)=>({id,shape,position,size,color,parent,collision});
const joint=(id,node,type,axis,limits,open,mass)=>({
  id,node,type,axis,limits,open,mass,friction:.6,stiffness:85,damping:13
});

export function industrialCabinetDraft() {
  return {
    schema:'agentscape.mechanical-draft',schemaVersion:1,
    name:'自定义工业储物柜',type:'cabinet',
    components:[
      item('LeftWall','box',[-.88,1.12,0],[.08,1.88,.73],'#344451'),
      item('RightWall','box',[.88,1.12,0],[.08,1.88,.73],'#344451'),
      item('Roof','box',[0,2.09,0],[1.84,.08,.73],'#344451'),
      item('Base','box',[0,.18,0],[1.84,.08,.73],'#344451'),
      item('RearWall','box',[0,1.12,-.35],[1.76,1.88,.056],'#1a2833'),
      item('Divider','box',[0,1.12,0],[1.72,.08,.68],'#1a2833'),
      item('UpperShelf','box',[0,1.61,-.01],[1.72,.045,.66],'#344451'),
      item('LeftDoorHinge','group',[-.81,1.59,.393],[1,1,1],'#526e82'),
      item('LeftDoor','box',[.395,0,0],[.774,.86,.056],'#526e82','LeftDoorHinge'),
      item('RightDoorHinge','group',[.81,1.59,.393],[1,1,1],'#526e82'),
      item('RightDoor','box',[-.395,0,0],[.774,.86,.056],'#526e82','RightDoorHinge'),
      item('UpperDrawerSlide','group',[0,.81,0],[1,1,1],'#667d8c'),
      item('UpperDrawer','box',[0,0,.09],[1.5,.29,.58],'#667d8c','UpperDrawerSlide'),
      item('UpperPull','box',[0,0,.49],[.32,.04,.04],'#b5c2ca','UpperDrawerSlide',false),
      item('LowerDrawerSlide','group',[0,.41,0],[1,1,1],'#667d8c'),
      item('LowerDrawer','box',[0,0,.09],[1.5,.29,.58],'#667d8c','LowerDrawerSlide'),
      item('LowerPull','box',[0,0,.49],[.32,.04,.04],'#b5c2ca','LowerDrawerSlide',false)
    ],
    motions:[
      joint('left_door','LeftDoorHinge','revolute',[0,1,0],[-1.35,0],-1.3,5),
      joint('right_door','RightDoorHinge','revolute',[0,1,0],[0,1.35],1.3,5),
      joint('upper_drawer','UpperDrawerSlide','prismatic',[0,0,1],[0,.48],.45,4),
      joint('lower_drawer','LowerDrawerSlide','prismatic',[0,0,1],[0,.48],.45,4)
    ]
  };
}
