import * as THREE from 'three';
import * as z from 'zod/v4';
import { inferCarryCapability } from './interaction/CarryCapability.js';

const fail=code=>Object.assign(new Error(code),{code});
const id=z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/);
const number=z.number().finite().min(-1e6).max(1e6);
const vec3=z.tuple([number,number,number]);
const quaternion=z.tuple([number,number,number,number]).refine(q=>Math.abs(Math.hypot(...q)-1)<.001);
const pose=z.object({position:vec3,rotation:quaternion}).strict();
const motion=z.object({linearVelocity:vec3,angularVelocity:vec3,sleeping:z.boolean()}).strict();
const held=z.object({kind:z.literal('agent'),id,anchor:z.literal('hold')}).strict();
const partSnapshot=z.object({name:id,pose,motion,motorTarget:number.nullable()}).strict();
const base={id,signature:z.string().regex(/^[a-f0-9]{64}$/),bindingId:z.string().uuid().optional()};
const record=z.discriminatedUnion('body',[
  z.object({...base,body:z.literal('kinematic')}).strict(),
  z.object({...base,body:z.literal('fixed'),pose,parts:z.array(partSnapshot).min(1).max(16).optional()}).strict(),
  z.object({...base,body:z.literal('dynamic'),pose,motion,heldBy:held.nullable()}).strict()
]);
const schema=z.object({schema:z.literal('agentscape.native-physics-state'),schemaVersion:z.literal(1),
  bodies:z.array(record).max(1024)}).strict();

export function nativePhysicsBindings(runtime){
  const bindings=new Map();
  for(const item of runtime.entities?.list?.({source:'native',capability:'physics'})||[]){
    const entity=runtime.entities.get(item.id);
    const spec=entity.manifest?.physics;
    let mounted=false;
    for(let node=entity.object;node;node=node.parent)if(node.uuid===entity.metadata.hostSceneUuid){mounted=true;break;}
    if(!mounted||!spec||!entity.metadata.physicsSignature||!entity.metadata.bindingId)throw fail('NATIVE_PHYSICS_BINDING_INVALID');
    bindings.set(entity.id,entity);
  }
  return bindings;
}

/** Portable snapshots identify the source-declared body; history additionally pins the live registration. */
export function captureNativePhysics(runtime,{identity=false}={}){
  const bindings=nativePhysicsBindings(runtime);
  if(!bindings.size)return undefined;
  const bodies=[];
  for(const [id,entity] of [...bindings].sort(([a],[b])=>a.localeCompare(b,'en'))){
    const spec=entity.manifest.physics,entry=runtime.physics.entries.get(id);
    if(entity.manifest.nativeArticulation)linkNodes(entity);
    if(!entry?.body||entry.root!==entity.object||entry.parts.size!==Object.keys(entity.manifest.parts||{}).length)throw fail('NATIVE_PHYSICS_BODY_UNAVAILABLE');
    const body=spec.body;
    const row={id,signature:entity.metadata.physicsSignature,body,...(identity?{bindingId:entity.metadata.bindingId}:{})};
    const heldBy=entity.state?.heldBy||null;
    const actual=runtime.physics.backend.bodyType(entry.body);
    if(actual!==(heldBy?'kinematic':body)||Boolean(entry.held)!==Boolean(heldBy))throw fail('NATIVE_PHYSICS_OWNERSHIP_MISMATCH');
    if(body!=='kinematic')row.pose=runtime.physics.backend.bodyPose(entry.body);
    if(body==='dynamic'){
      const {linearVelocity,angularVelocity,sleeping}=runtime.physics.getMotion(id);
      row.motion={linearVelocity:heldBy?[0,0,0]:linearVelocity,angularVelocity:heldBy?[0,0,0]:angularVelocity,sleeping:heldBy?false:sleeping};
      row.heldBy=heldBy?structuredClone(heldBy):null;
    }
    if(entry.parts.size)row.parts=[...entry.parts].map(([name,part])=>{
      if(runtime.physics.backend.bodyType(part.body)!=='dynamic')throw fail('NATIVE_ARTICULATION_BODY_INVALID');
      const {linearVelocity,angularVelocity,sleeping}=runtime.physics.backend.bodyMotion(part.body);
      return {name,pose:runtime.physics.backend.bodyPose(part.body),motion:{linearVelocity,angularVelocity,sleeping},motorTarget:part.motorTarget??null};
    });
    bodies.push(row);
  }
  return validateNativePhysics({schema:'agentscape.native-physics-state',schemaVersion:1,bodies});
}

export function validateNativePhysics(input,objects=null){
  const result=schema.safeParse(input);
  if(!result.success)throw fail('NATIVE_PHYSICS_SNAPSHOT_INVALID');
  const snapshot=result.data,ids=new Set(),owners=new Set();
  const managed=objects&&new Map(objects.map(object=>[object.id,object]));
  if(objects)for(const object of objects)if(object.state?.heldBy?.kind==='agent')owners.add(object.state.heldBy.id);
  if(snapshot.bodies.reduce((n,row)=>n+1+(row.parts?.length||0),0)>1024)throw fail('NATIVE_PHYSICS_SNAPSHOT_LIMIT');
  for(const row of snapshot.bodies){
    if(row.parts&&new Set(row.parts.map(p=>p.name)).size!==row.parts.length)throw fail('NATIVE_ARTICULATION_SNAPSHOT_INVALID');
    if(ids.has(row.id)||managed?.has(row.id))throw fail('NATIVE_PHYSICS_ID_CONFLICT');
    ids.add(row.id);
    if(row.heldBy){
      const owner=row.heldBy.id;
      if(owners.has(owner)||(managed&&(!managed.has(owner)||managed.get(owner).active===false)))throw fail('NATIVE_PHYSICS_HELD_OWNER_INVALID');
      if(row.motion.sleeping||[...row.motion.linearVelocity,...row.motion.angularVelocity].some(n=>n!==0))throw fail('NATIVE_PHYSICS_HELD_MOTION_INVALID');
      owners.add(owner);
    }
  }
  return snapshot;
}

/** Preflight before resetting a solver or replacing any managed entity. No body definitions are trusted from a save. */
export function prepareNativePhysics(runtime,input,objects=null,{compatible=false}={}){
  const snapshot=validateNativePhysics(input,objects),bindings=nativePhysicsBindings(runtime),selected=[],skipped=[];
  const matches=row=>{
    const entity=bindings.get(row.id);
    return entity&&entity.metadata.physicsSignature===row.signature&&entity.manifest.physics.body===row.body&&
      (!row.bindingId||entity.metadata.bindingId===row.bindingId);
  };
  for(const row of snapshot.bodies){
    if(!matches(row)){
      if(!compatible||row.heldBy)throw fail('NATIVE_PHYSICS_BINDING_MISMATCH');
      skipped.push({id:row.id,reason:'BINDING_CHANGED_OR_MISSING'});continue;
    }
    if(row.heldBy&&(bindings.get(row.id).manifest.physics.carryable!==true||!inferCarryCapability(bindings.get(row.id).manifest).eligible))throw fail('NATIVE_PHYSICS_HELD_BODY_INVALID');
    validateArticulationSnapshot(bindings.get(row.id),row);
    selected.push(row);
  }
  const selectedIds=new Set(selected.map(row=>row.id));
  for(const id of bindings.keys())if(!selectedIds.has(id)){
    if(!compatible)throw fail('NATIVE_PHYSICS_BINDING_MISMATCH');
    if(!skipped.some(row=>row.id===id))skipped.push({id,reason:'NEW_BINDING'});
  }
  return {snapshot:{...snapshot,bodies:selected},bindings,skipped};
}

function linkNodes(entity){
  const definitions=entity.manifest.parts||{},nodes=new Map();
  if(!Object.keys(definitions).length)return nodes;
  const names=new Set(Object.values(definitions).map(part=>part.node)),byName=new Map();
  let count=0;
  entity.object.traverse(node=>{
    if(++count>8192)throw fail('NATIVE_ARTICULATION_NODE_LIMIT');
    if(!names.has(node.name))return;
    if(node===entity.object||byName.has(node.name))throw fail('NATIVE_ARTICULATION_LINK_HIERARCHY_INVALID');
    byName.set(node.name,node);
  });
  for(const [id,part] of Object.entries(definitions)){
    const node=byName.get(part.node);
    const parent=part.parent==='$root'?entity.object:byName.get(definitions[part.parent]?.node);
    if(!node||!parent||node.uuid!==entity.metadata.articulationNodeUuids?.[id]||node.parent!==parent||!node.matrixAutoUpdate||
      node.scale.toArray().some(n=>!Number.isFinite(n)||Math.abs(n-1)>1e-6))throw fail('NATIVE_ARTICULATION_LINK_HIERARCHY_INVALID');
    nodes.set(id,node);
  }
  return nodes;
}

function relativePose(parent,child){
  const inverse=new THREE.Quaternion(...parent.rotation).invert();
  return {position:new THREE.Vector3(...child.position).sub(new THREE.Vector3(...parent.position)).applyQuaternion(inverse).toArray(),
    rotation:inverse.multiply(new THREE.Quaternion(...child.rotation)).normalize().toArray()};
}

function validateArticulationSnapshot(entity,row){
  const definitions=entity.manifest.parts||{},expected=Object.keys(definitions),parts=row.parts||[];
  if(parts.length!==expected.length||parts.some(p=>!Object.hasOwn(definitions,p.name)))
    throw fail('NATIVE_ARTICULATION_SNAPSHOT_MISMATCH');
  if(!parts.length)return;
  linkNodes(entity);
  const poses=new Map(parts.map(p=>[p.name,p.pose]));poses.set('$root',row.pose);
  for(const part of parts){
    const definition=definitions[part.name],joint=definition.joint,rest=entity.metadata.articulationRest[part.name];
    const local=relativePose(poses.get(definition.parent),part.pose);
    const axis=new THREE.Vector3(...joint.axis),rotation=new THREE.Quaternion(...local.rotation);
    const delta=rotation.clone().multiply(new THREE.Quaternion(...rest.rotation).invert()).normalize();
    const displacement=new THREE.Vector3(...local.position).sub(new THREE.Vector3(...rest.position));
    const coordinate=joint.type==='prismatic'?displacement.dot(axis):
      Math.atan2(Math.sin(2*Math.atan2(delta.x*axis.x+delta.y*axis.y+delta.z*axis.z,delta.w)),
        Math.cos(2*Math.atan2(delta.x*axis.x+delta.y*axis.y+delta.z*axis.z,delta.w)));
    const expectedRotation=joint.type==='prismatic'?new THREE.Quaternion(...rest.rotation):
      new THREE.Quaternion().setFromAxisAngle(axis,coordinate).multiply(new THREE.Quaternion(...rest.rotation));
    const anchorError=new THREE.Vector3(...local.position).add(new THREE.Vector3(...joint.childAnchor).applyQuaternion(rotation))
      .sub(new THREE.Vector3(...joint.parentAnchor));
    if(joint.type==='prismatic')anchorError.addScaledVector(axis,-coordinate);
    const tolerance=joint.type==='prismatic'?.03:.08;
    if(!Number.isFinite(coordinate)||coordinate<joint.limits[0]-tolerance||coordinate>joint.limits[1]+tolerance||
      anchorError.length()>.06||rotation.angleTo(expectedRotation)>.1||
      (part.motorTarget!==null&&(part.motorTarget<joint.limits[0]||part.motorTarget>joint.limits[1])))
      throw fail('NATIVE_ARTICULATION_SNAPSHOT_POSE_INVALID');
  }
}

function localPose(entity,worldPose){
  const object=entity.object,parent=object.parent;
  const position=new THREE.Vector3(...worldPose.position),rotation=new THREE.Quaternion(...worldPose.rotation);
  if(parent){
    parent.updateWorldMatrix(true,false);
    const p=new THREE.Vector3(),q=new THREE.Quaternion(),s=new THREE.Vector3();
    parent.matrixWorld.decompose(p,q,s);
    if(s.toArray().some(value=>Math.abs(value-1)>1e-6)||
       parent.matrixWorld.elements.some((value,index)=>Math.abs(value-new THREE.Matrix4().compose(p,q,s).elements[index])>1e-6))
      throw fail('NATIVE_PHYSICS_PARENT_TRANSFORM_INVALID');
    parent.worldToLocal(position);rotation.premultiply(q.invert()).normalize();
  }
  return {position:position.toArray(),rotation:rotation.toArray()};
}

/** Called after managed agents and their held ownership have been restored. Native objects are never recreated. */
export function applyNativePhysics(runtime,prepared){
  const {snapshot,bindings}=prepared;
  const carry=runtime.interactions?.carry;
  for(const entity of bindings.values()){
    if(entity.state?.heldBy)carry.releaseHeld(entity.id,'NATIVE_PHYSICS_RESTORE',{silent:true});
    const entry=runtime.physics.entries.get(entity.id);
    if(!entry){
      // Recreate joints at the authored rest frame, never at a previously moved pose.
      for(const [name,node] of linkNodes(entity)){
        const rest=entity.metadata.articulationRest[name];
        node.position.fromArray(rest.position);node.quaternion.fromArray(rest.rotation);
      }
      entity.object.updateMatrixWorld(true);
      runtime.physics.addObject(entity.id,entity.manifest,entity.object);
    }
    else if(entry.root!==entity.object)throw fail('NATIVE_PHYSICS_BODY_CONFLICT');
    if(entity.manifest.physics.body==='kinematic'){
      // Source restore() can update host-owned kinematic objects after setup.
      // Synchronize immediately without treating their visual state as solver-owned.
      const body=runtime.physics.entries.get(entity.id).body;
      const pose={position:entity.object.getWorldPosition(new THREE.Vector3()).toArray(),
        rotation:entity.object.getWorldQuaternion(new THREE.Quaternion()).toArray()};
      runtime.physics.backend.setBodyPose(body,{...pose,wake:false});
      runtime.physics.backend.setBodyPose(body,{...pose,next:true,wake:false});
    }
  }
  // First restore all solver-owned bodies; then validate and rebuild anchor ownership.
  const checkpoints=[];
  for(const row of snapshot.bodies){
    if(row.body==='kinematic')continue; // Host code, not the serializer, owns this transform.
    const entity=bindings.get(row.id),heldBy=row.heldBy||null;
    const root={...localPose(entity,row.pose),type:heldBy?'kinematic':row.body,pose:row.pose,
      ...(row.motion?{motion:row.motion}:{}),...(heldBy?{nextPose:row.pose}:{})};
    const savedParts=new Map((row.parts||[]).map(part=>[part.name,part]));
    const poses=new Map((row.parts||[]).map(part=>[part.name,part.pose]));poses.set('$root',row.pose);
    const entry=runtime.physics.entries.get(row.id);
    const parts=[...entry.parts].map(([name,part])=>{
      const saved=savedParts.get(name);
      if(!saved)throw fail('NATIVE_ARTICULATION_SNAPSHOT_MISMATCH');
      return {name,...relativePose(poses.get(part.parentName),saved.pose),type:'dynamic',pose:saved.pose,motion:saved.motion,motorTarget:saved.motorTarget};
    });
    checkpoints.push({id:row.id,root,parts,held:Boolean(heldBy),heldOriginalType:heldBy?'dynamic':null});
  }
  runtime.physics.restoreState(checkpoints);
  runtime.physics.backend.syncSceneQueries(runtime.physics.world);
  for(const row of snapshot.bodies){
    if(!row.heldBy)continue;
    const {id:actor}=row.heldBy,entity=bindings.get(row.id);
    const owner=runtime.store.has(actor)?runtime.store.get(actor):null;
    if(!carry||!owner||owner.active===false||owner.manifest.type!=='agent'||carry.heldByAgent(actor))throw fail('NATIVE_PHYSICS_HELD_OWNER_INVALID');
    const anchor=runtime.physics.anchorPose(actor,carry.holdAnchor(actor));
    const positionError=anchor?Math.hypot(...row.pose.position.map((n,i)=>n-anchor.position[i])):Infinity;
    const angleError=anchor?new THREE.Quaternion(...row.pose.rotation).angleTo(new THREE.Quaternion(...anchor.rotation)):Infinity;
    if(positionError>.15||angleError>.2||!runtime.physics.checkBodyPose(row.id,row.pose.position,row.pose.rotation,{excludeIds:[actor]}).clear)
      throw fail('NATIVE_PHYSICS_HELD_POSE_INVALID');
    entity.state.heldBy=structuredClone(row.heldBy);
    carry.agentHeld.set(actor,row.id);
    runtime.physics.setHeldTarget(row.id,anchor.position,anchor.rotation);
  }
  runtime.navigation?.invalidate?.('native-physics-restored');
  return {restored:snapshot.bodies.length,skipped:prepared.skipped};
}
