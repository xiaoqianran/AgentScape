import { rigidBodyActions,manipulationParameters } from '../interaction/ManipulationActions.js';
import { nativePhysicalTarget,nativeCarryRecord } from '../interaction/NativePhysicalTarget.js';
import { inferCarryCapability } from '../interaction/CarryCapability.js';

/** Read the same live rigid body that drives the host object, never a semantic guess. */
export function inspectNativePhysics(runtime,id){
  const entity=nativePhysicalTarget(runtime?.entities,runtime?.physics,id);
  if(!entity)return null;
  const body=runtime.physics?.manipulationBody?.(id);
  const registered=Boolean(body?.registered&&body.colliderCount>0);
  const position=registered?runtime.physics.getPosition(id):null;
  const rotation=registered?runtime.physics.getRotation(id):null;
  const motion=registered?runtime.physics.getMotion(id):null;
  const state={registered,manipulable:entity.metadata.manipulable===true,carryable:entity.metadata.carryable===true,
    held:!!entity.state?.heldBy,heldById:entity.state?.heldBy?.id??null,body:body?.body??null,mass:body?.mass??null,colliderCount:body?.colliderCount??0,
    ...(position?{positionX:position[0],positionY:position[1],positionZ:position[2]}:{}),
    ...(motion?{linearSpeed:motion.linearSpeed,angularSpeed:motion.angularSpeed,sleeping:motion.sleeping}:{})};
  const joints=Object.entries(entity.manifest?.parts||{}).map(([partName,part])=>{
    const live=runtime.physics.getArticulationState(id,partName);
    const pending=runtime.interactions?.articulationTasks?.get(id+':'+partName);
    const motorTarget=runtime.physics.entries.get(id)?.parts.get(partName)?.motorTarget??null;
    return {partName,node:part.node,parent:part.parent,type:part.joint.type,axis:[...part.joint.axis],
      limits:[...part.joint.limits],coordinate:live?.coordinate??null,motorTarget,moving:!!pending};
  });
  for(const joint of joints)state['joint:'+joint.partName]=joint.coordinate;
  return {source:'native-physics',colliderSource:entity.metadata.colliderSource||'declared',joints,
    transformAuthority:entity.transformAuthority,state,position,rotation,surfaces:structuredClone(entity.metadata.surfaces||[]),physicsVerified:false};
}


/** Discovery reads live availability; registration alone is not successful execution. */
export function nativeManipulationActions(runtime,id,actor=null){
  const record=nativeCarryRecord(runtime.entities,runtime.physics,id);
  if(!record)return [];
  const manipulable=Boolean(runtime.interactions?.nativeManipulationTarget?.(id));
  let access={available:null,reason:'ACTOR_REQUIRED_FOR_REACH_CHECK'};
  if(actor){
    if(!runtime.store.has(actor))access={available:false,reason:'ACTOR_NOT_FOUND'};
    else if(runtime.store.get(actor).manifest.type!=='agent')access={available:false,reason:'ACTOR_NOT_AGENT'};
    else{
      try{
        const reach=runtime.interactions.interactionStatus(actor,id);
        access={available:reach.interactable,reason:reach.interactable?null:reach.inRange?'OCCLUDED':'OUT_OF_REACH'};
      }catch(error){access={available:false,reason:error.details?.reason||error.code||'CAPABILITY_CHECK_FAILED'};}
    }
  }
  const reachAccess=access;
  if(actor&&runtime.interactions.heldByAgent(actor))access={available:false,reason:'HANDS_FULL'};
  const actions=manipulable?rigidBodyActions.map(action=>{
    const capability=runtime.interactions.manipulationCapability(id,action);
    const live=capability.available?access:capability;
    return {action,source:'native-physics',execution:'interaction',parameters:manipulationParameters(action),
      ...live,canApproach:['OUT_OF_REACH','OCCLUDED'].includes(live.reason)&&Boolean(runtime.navigation?.findPath&&runtime.locomotion?.navigate),
      verification:action==='rotate'?'rigid-body-torque':'rigid-body-force',graspVerified:false};
  }):[];
  const descriptor=(action,live,parameters,verification)=>({action,source:'native-physics',execution:'interaction',parameters,
    ...live,canApproach:['OUT_OF_REACH','OCCLUDED'].includes(live.reason)&&Boolean(runtime.navigation?.findPath&&runtime.locomotion?.navigate),
    verification,graspVerified:false});
  for(const [partName,part] of Object.entries(record.manifest.parts||{})){
    const action=part.joint.type==='prismatic'?'slide':'rotateJoint',relative=action==='slide'?'distance':'angle',unit=action==='slide'?'meter':'radian';
    const capability=runtime.interactions.manipulationCapability(id,action,partName);
    let live=capability.available?access:capability;
    if(capability.available&&actor&&runtime.store.has(actor)&&runtime.store.get(actor).manifest.type==='agent'&&!runtime.interactions.heldByAgent(actor)){
      const aimPoint=runtime.physics.manipulationBody(id,partName,{contacts:true}).contactCandidates[0]?.center;
      if(aimPoint){const reach=runtime.interactions.interactionStatus(actor,id,{aimPoint,aimPart:partName});
        live={available:reach.interactable,reason:reach.interactable?null:reach.inRange?'OCCLUDED':'OUT_OF_REACH'};}
    }
    actions.push({...descriptor(action,live,{part:{type:'string',enum:[partName],required:true},
      target:{type:'number',required:false,alternative:relative,unit,limits:[...part.joint.limits]},
      [relative]:{type:'number',required:false,alternative:'target',relative:true,unit}},'joint-motor'),partName});
  }
  const held=record.state.heldBy,owned=held?.kind==='agent'&&held.id===actor;
  if(record.manifest.physics.carryable===true){
    const assessment=inferCarryCapability(record.manifest);
    const live=assessment.eligible?(held&&!owned?{available:false,reason:'OBJECT_ALREADY_HELD'}:
      owned?{available:true}:access):{available:false,reason:assessment.reason};
    actions.push(descriptor('pickup',live,{},'kinematic-anchor'));
    actions.push(descriptor('drop',actor?{available:Boolean(owned),reason:owned?null:'NOT_HOLDING_OBJECT'}:
      {available:null,reason:'ACTOR_REQUIRED_FOR_REACH_CHECK'}, {},'dynamic-settle'));
  }
  if(record.manifest.surfaces.length){
    const heldId=actor&&runtime.interactions?.heldByAgent(actor);
    const heldRecord=heldId?(runtime.store.has(heldId)?runtime.store.get(heldId):nativeCarryRecord(runtime.entities,runtime.physics,heldId)):null;
    const live=actor&&!heldId?{available:false,reason:'NOT_HOLDING_OBJECT'}:
      heldId?heldRecord&&runtime.interactions.supports(heldRecord,'place')?reachAccess:{available:false,reason:'ACTION_UNSUPPORTED'}:reachAccess;
    actions.push(descriptor('place',live,{surfaceId:{type:'string',enum:record.manifest.surfaces.map(s=>s.id),required:false}},'solver-contact+spatial-geometry'));
  }
  return actions;
}
