import * as THREE from 'three';
import * as z from 'zod/v4';

const fail=code=>Object.assign(new Error(code),{code});
const name=z.string().regex(/^[A-Za-z][A-Za-z0-9_-]{0,63}$/);
const vector=z.tuple([z.number().finite().min(-100).max(100),z.number().finite().min(-100).max(100),z.number().finite().min(-100).max(100)]);
const joint=z.object({
  type:z.enum(['revolute','prismatic']),axis:vector.refine(v=>Math.hypot(...v)>1e-6),
  limits:z.tuple([z.number().finite(),z.number().finite()]).refine(([a,b])=>a<b&&a<=0&&b>=0),
  parentAnchor:vector.optional(),childAnchor:vector.default([0,0,0]),
  motor:z.object({stiffness:z.number().positive().max(1000),damping:z.number().positive().max(100)}).strict().default({stiffness:80,damping:12})
}).strict();

/** Adopt explicitly authored links, never infer hinges from geometry or names. */
export function parseNativeArticulation(root,raw,physicsSchema){
  const schema=z.record(name,z.object({node:z.string().min(1).max(128),parent:z.union([name,z.literal('$root')]).default('$root'),
    physics:physicsSchema,joint}).strict());
  const parsed=schema.safeParse(raw);
  if(!parsed.success||Object.keys(raw).length>16)throw fail('NATIVE_ARTICULATION_INVALID');
  const parts=parsed.data,rest={},nodes=new Map(),nameCounts=new Map();
  let count=0;
  root.traverse(node=>{
    if(++count>8192)throw fail('NATIVE_ARTICULATION_NODE_LIMIT');
    if(node===root)return;
    if(node.name){nameCounts.set(node.name,(nameCounts.get(node.name)||0)+1);nodes.set(node.name,node);}
  });
  const used=new Set();
  for(const [id,part] of Object.entries(parts)){
    if(part.parent!=='$root')throw fail('NATIVE_ARTICULATION_SERIAL_CHAIN_UNSUPPORTED');
    const node=nodes.get(part.node),parent=root;
    if(!node||part.node===root.name||nameCounts.get(part.node)!==1||used.has(node)||!parent||node.parent!==parent)
      throw fail('NATIVE_ARTICULATION_LINK_HIERARCHY_INVALID');
    used.add(node);
    if(!node.matrixAutoUpdate||node.position.toArray().some(n=>!Number.isFinite(n)||Math.abs(n)>100)||
      node.quaternion.toArray().some(n=>!Number.isFinite(n))||node.scale.toArray().some(n=>!Number.isFinite(n)||Math.abs(n-1)>1e-6)||
      1-Math.abs(node.quaternion.w)>1e-7)throw fail('NATIVE_ARTICULATION_REST_FRAME_INVALID');
    if(part.physics.body!=='dynamic'||raw[id].physics.mass==null||
      part.physics.carryable===true||part.physics.manipulable===true||
      part.physics.lockTranslation?.some(Boolean)||part.physics.lockRotation?.some(Boolean))
      throw fail('NATIVE_ARTICULATION_LINK_PHYSICS_INVALID');
    const [lo,hi]=part.joint.limits,limit=part.joint.type==='revolute'?Math.PI-.001:10;
    if(lo < -limit||hi>limit)throw fail('NATIVE_ARTICULATION_LIMIT_INVALID');
    const {childAnchor}=part.joint;
    const expected=node.position.clone().add(new THREE.Vector3(...childAnchor));
    if(part.joint.parentAnchor&&expected.distanceTo(new THREE.Vector3(...part.joint.parentAnchor))>1e-5)
      throw fail('NATIVE_ARTICULATION_ANCHOR_MISMATCH');
    part.joint.parentAnchor=expected.toArray();
    part.joint.axis=new THREE.Vector3(...part.joint.axis).normalize().toArray();
    rest[id]={position:node.position.toArray(),rotation:node.quaternion.toArray()};
    part.actions=[];part.targets={};
  }
  return {parts,rest};
}
