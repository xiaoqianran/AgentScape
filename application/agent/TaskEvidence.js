/** Task admission evidence, not a new source of world state. No renderer or transport dependency. */
const dimensions=Object.freeze(['structure','behavior','visual']);
const boundedCode=value=>typeof value==='string'&&/^[A-Z_]{3,80}$/.test(value)?value:undefined;
const same=(a,b)=>Array.isArray(a)&&Array.isArray(b)?a.length===b.length&&a.every((v,i)=>Object.is(v,b[i])):Object.is(a,b);
const dimensionOf=kind=>['state-equals','interaction-verified'].includes(kind)?'behavior':'structure';

/** Envelope-level check only; final admission additionally validates exact criteria. */
export function acceptedSceneChecks(result){
  const evidence=result?.verification?.evidence;
  return result?.schema==='agentscape.scene-result'&&result.operation==='verify'&&result.status==='succeeded'&&
    result.verification?.status==='verified'&&evidence?.status==='world-accepted'&&Array.isArray(evidence.checks)&&
    evidence.checks.length&&evidence.checks.every(check=>check?.verified===true)?evidence.checks:[];
}

export function worldBinding(world={}){
  return Object.fromEntries(['worldSessionId','projectId','projectRevision','runtimeId','sceneRevision'].map(key=>[key,world[key]??null]));
}

export function matchesWorldBinding(observation,world){
  if(!world)return true;
  if(!observation)return false;
  const actual={...observation,projectRevision:observation.projectRevision??observation.revision};
  return Object.entries(worldBinding(world)).every(([key,value])=>value==null||actual[key]===value);
}

/** Frame/tick identify a sampled runtime state independently of editable revisions. */
export function observationFrame(value){
  const frame=value?.frame??value?.playback?.frames,tick=value?.tick??value?.playback?.simulation?.tick;
  return Number.isSafeInteger(frame)&&frame>=0&&Number.isSafeInteger(tick)&&tick>=0?{frame,tick}:null;
}

export function matchesObservationFrame(value,expected){
  if(!expected)return true;
  const observed=observationFrame(value);
  return Boolean(observed&&observed.frame===expected.frame&&observed.tick===expected.tick);
}

function criterionRecord(criterion){
  return {id:criterion.id,kind:criterion.kind,dimension:dimensionOf(criterion.kind),
    type:criterion.kind==='interaction-verified'?'action-receipt':criterion.kind==='state-equals'?'state-snapshot':'world-postcondition',
    criterion:structuredClone(criterion)};
}

export function pendingSceneRecords(criteria){
  return criteria.map(criterion=>({...criterionRecord(criterion),status:'unverified',reason:'CHECK_NOT_OBSERVED'}));
}

function matchesCriterion(check,criterion){
  if(!check||check.id!==criterion.id||check.kind!==criterion.kind||typeof check.verified!=='boolean')return false;
  switch(criterion.kind){
    case 'world-valid':return true;
    case 'object-exists':return check.targetId===criterion.targetId;
    case 'state-equals':
      return check.targetId===criterion.targetId&&check.stateKey===criterion.stateKey&&same(check.expected,criterion.value)&&
        (!criterion.source||check.source===criterion.source)&&(!check.verified||same(check.actual,criterion.value));
    case 'interaction-verified':{
      if(check.targetId!==criterion.targetId||check.expected!==criterion.capability||
         (criterion.source&&check.source!==criterion.source)||(criterion.partName&&check.partName!==criterion.partName))return false;
      if(!check.verified)return true;
      const receipt=check.evidence;
      const source=criterion.source==='asset'?'physical-articulation':criterion.source==='project'?'project-defined':criterion.source;
      return receipt?.schema==='agentscape.interaction-evidence'&&receipt.schemaVersion===1&&receipt.verified===true&&
        receipt.targetId===criterion.targetId&&receipt.capability===criterion.capability&&
        typeof receipt.worldRevisionId==='string'&&receipt.worldRevisionId.length>0&&typeof receipt.source==='string'&&receipt.source.length>0&&
        (!source||receipt.source===source)&&(!criterion.partName||receipt.partName===criterion.partName);
    }
    case 'relation-exists':
      return check.subject===criterion.subject&&check.predicate===criterion.predicate&&
        same(check.object,criterion.object)&&same(check.objectAnyOf,criterion.objectAnyOf)&&same(check.surfaceId,criterion.surfaceId);
    default:return false;
  }
}

/** Validate independent live verifier coverage. A successful envelope cannot omit or substitute required checks. */
export function collectSceneChecks(result,criteria,{allowScopedExtras=false}={}){
  const evidence=result?.verification?.evidence;
  const validEnvelope=result?.schema==='agentscape.scene-result'&&result.operation==='verify'&&
    result.status==='succeeded'&&Array.isArray(evidence?.checks)&&evidence.checks.length>0;
  const returned=validEnvelope?evidence.checks:[];
  const byId=new Map(),duplicate=new Set();
  for(const check of returned){
    if(typeof check?.id!=='string')continue;
    if(byId.has(check.id))duplicate.add(check.id);
    byId.set(check.id,check);
  }
  const ids=new Set(criteria.map(item=>item.id));
  const extras=returned.filter(check=>!ids.has(check?.id));
  const extrasValid=extras.every(check=>allowScopedExtras&&typeof check?.id==='string'&&check.id.startsWith('task-entity-')&&
    check.kind==='object-exists'&&typeof check.targetId==='string'&&check.targetId.length>0&&typeof check.verified==='boolean');
  const expected=extrasValid?[...criteria,...extras.map(({id,kind,targetId})=>({id,kind,targetId}))]:criteria;
  const records=expected.map(criterion=>{
    const check=byId.get(criterion.id);
    const valid=!duplicate.has(criterion.id)&&matchesCriterion(check,criterion);
    return {...criterionRecord(criterion),
      status:!valid?'unverified':check.verified?'verified':(check.truth==='unknown'||check.kind==='interaction-verified')?'unverified':'failed',
      ...(!valid?{reason:'CHECK_RESPONSE_MISMATCH'}:!check.verified?{reason:boundedCode(check.reason)||'CHECK_UNVERIFIED'}:{}),
      ...(valid&&typeof check.source==='string'?{source:check.source}:{}),
      ...(valid&&typeof check.evidenceKind==='string'?{evidenceKind:check.evidenceKind}:{}),
      ...(valid&&check.kind==='state-equals'&&(check.actual===null||['string','number','boolean'].includes(typeof check.actual))?{actual:check.actual}:{}),
      ...(valid&&check.kind==='interaction-verified'&&check.verified?{receipt:{
        source:check.evidence.source,worldRevisionId:check.evidence.worldRevisionId,
        ...(check.evidence.partName?{partName:check.evidence.partName}:{}),
        ...(check.evidence.commandId?{commandId:check.evidence.commandId}:{})
      }}:{})};
  });
  const accepted=validEnvelope&&duplicate.size===0&&extrasValid&&criteria.length>0&&
    acceptedSceneChecks(result).length>0&&records.every(item=>item.status==='verified');
  return {accepted,records,checks:validEnvelope?returned:[]};
}

/** Native inspection is a bounded observation, never a geometric/visual verdict. */
export function nativeObservation(value,world){
  if(value?.status!=='inspected'||!matchesWorldBinding(value,world)||
    value.node?.nodePath!==''||!Number.isSafeInteger(value.counts?.nodes)||value.counts.nodes<1||
    typeof value.boundsComplete!=='boolean')return {status:'unavailable',reason:'NATIVE_EVIDENCE_INVALID'};
  const counts=Object.fromEntries(Object.entries(value.counts).filter(([,n])=>Number.isSafeInteger(n)&&n>=0));
  return {status:'observed',source:'scene_query',binding:worldBinding(world),counts,
    boundsComplete:value.boundsComplete,
    ...(value.bounds&&['min','max','size'].every(key=>Array.isArray(value.bounds[key])&&value.bounds[key].length===3&&value.bounds[key].every(Number.isFinite))?
      {bounds:{min:value.bounds.min,max:value.bounds.max,size:value.bounds.size}}:{}),
    limitations:Array.isArray(value.limitations)?value.limitations.filter(x=>typeof x==='string').slice(0,20):[],
    ...(Number.isSafeInteger(value.playback?.frames)?{frame:value.playback.frames}:{}),
    ...(Number.isSafeInteger(value.playback?.simulation?.tick)?{tick:value.playback.simulation.tick}:{})};
}

function category(records,bound){
  if(!records.length)return {required:false,status:'not-required',checks:[]};
  const status=!bound?'unverified':records.every(x=>x.status==='verified')?'verified':
    records.some(x=>x.status==='failed')?'failed':'unverified';
  return {required:true,status,checks:records.map(record=>({...record,...(!bound&&record.status!=='unverified'?{status:'unverified',reason:'WORLD_BINDING_UNCONFIRMED'}:{})}))};
}

export function buildTaskEvidence({world,scope,records=[],bound=false,native=null,visualRequired=false,worldReady=false,reason=null,persistenceRequired=false,savedCheckpoint=null,taskSpecStatus,readOnly=false,snapshot=null}={}){
  const binding=worldBinding(world);
  const structure=category(records.filter(item=>item.dimension==='structure'),bound);
  if(native)structure.native=bound?native:{status:'unavailable',reason:'WORLD_BINDING_UNCONFIRMED'};
  const behavior=category(records.filter(item=>item.dimension==='behavior'),bound);
  const visual={required:visualRequired,status:visualRequired?'pending':'not-required',reviews:[]};
  return {schema:'agentscape.task-evidence',schemaVersion:1,binding,scope,
    ...(bound&&snapshot?{snapshot:{...snapshot,scope:'sampled-runtime-state'}}:{}),
    coverage:readOnly?'read-only':scope==='task-criteria'?(taskSpecStatus==='ready'?'user-derived-checks':'unresolved-user-requirements'):'agent-selected-postconditions',
    worldStatus:readOnly?'not-required':worldReady?'verified':bound?'unverified':'unconfirmed',
    reason:boundedCode(reason)??null,
    dimensions:{structure,behavior,visual},
    persistence:{required:persistenceRequired,status:!persistenceRequired?'not-required':
      bound&&savedCheckpoint&&matchesWorldBinding(savedCheckpoint,bindingWithoutSession(binding))?'verified':'unverified',
      ...(bound&&savedCheckpoint&&matchesWorldBinding(savedCheckpoint,bindingWithoutSession(binding))?{digest:savedCheckpoint.digest}:{})},
    limitations:['World validity and postconditions are not proof of all user intent.',
      'State and spatial checks are observations, not proof of executed motion.',
      'Code-world snapshot checks and image describe one sampled host frame, not continuous validity. Animation may advance afterwards; external timers and custom render side effects are not tracked.',
      'Persistence verifies the saved edit revision, not identical animated state at the later evidence frame.',
      'Native root counts may include Studio helpers and are not proof of a specific requested shape.']};
}
function bindingWithoutSession(binding){return {...binding,worldSessionId:null};}

/** Attach visual judgments only to the exact world that was independently accepted. */
export function withVisualTaskEvidence(result,visual,{invalidateWorld=false}={}){
  if(!result.evidence)return {...result,taskStatus:'incomplete',verified:false,visual:{status:'unavailable',reason:'WORLD_EVIDENCE_MISSING',reviews:[]}};
  const current=result.evidence;
  const fullyBound=['worldSessionId','projectId','runtimeId'].every(key=>typeof current.binding[key]==='string'&&current.binding[key].length>0)&&
    ['projectRevision','sceneRevision'].every(key=>Number.isSafeInteger(current.binding[key]));
  const history=visual.reviews||[];
  const reviews=history.map((review,index)=>({
    status:review.status,score:review.score,issues:review.issues,
    binding:worldBinding({...review,projectRevision:review.revision}),
    ...(review.imageDigest?{imageDigest:review.imageDigest}:{}),
    ...(Number.isSafeInteger(review.frame)?{frame:review.frame}:{}),
    ...(Number.isSafeInteger(review.tick)?{tick:review.tick}:{}),
    current:index===history.length-1&&!invalidateWorld&&fullyBound&&current.worldStatus==='verified'&&matchesWorldBinding(review,current.binding)&&matchesObservationFrame(review,current.snapshot)&&
      (!current.snapshot?.imageDigest||review.imageDigest===current.snapshot.imageDigest)
  }));
  const last=reviews.at(-1);
  const passed=visual.status==='passed'&&last?.current===true&&last.status==='passed'&&
    Number.isFinite(last.score)&&last.score>=7&&last.score<=10&&/^[a-f0-9]{64}$/.test(last.imageDigest||'');
  const status=passed?'assessed-pass':visual.status==='needs-revision'?'assessed-fail':
    visual.status==='passed'?'unavailable':visual.status;
  const categories={...current.dimensions,visual:{required:true,status,source:'model-review-of-real-frame',reviews,
    ...(visual.reason?{reason:visual.reason}:{}),...(visual.status==='passed'&&!passed?{reason:'VISUAL_EVIDENCE_MISMATCH'}:{})}};
  if(invalidateWorld){
    for(const name of dimensions.filter(name=>name!=='visual')){
      const dimension=categories[name];
      categories[name]={...dimension,status:dimension.required?'unverified':'not-required',
        checks:dimension.checks.map(check=>({...check,status:'unverified',reason:'WORLD_MAY_HAVE_CHANGED'})),
        ...(dimension.native?{native:{status:'unavailable',reason:'WORLD_MAY_HAVE_CHANGED'}}:{})};
    }
  }
  const complete=passed&&!invalidateWorld&&current.worldStatus==='verified'&&
    Object.values(categories).every(item=>!item.required||['verified','assessed-pass'].includes(item.status))&&
    (!current.persistence.required||current.persistence.status==='verified');
  const reason=visual.reason||'VISUAL_EVIDENCE_MISMATCH';
  return {...result,taskStatus:complete?'completed':'incomplete',verified:complete,
    ...(visual.status==='passed'&&!complete?{visual:{...visual,status:'unavailable',reason}}:{}),
    ...(complete?{unresolvedMutations:[]}:{unresolvedMutations:[...(result.unresolvedMutations||[]).filter(item=>item.reason!=='VISUAL_REVIEW_PENDING'),{reason:visual.reason||'VISUAL_EVIDENCE_MISMATCH'}]}),
    ...(invalidateWorld?{verification:{...result.verification,status:'unverified',reason:'WORLD_MAY_HAVE_CHANGED'}}:
      current.worldStatus==='verified'?{verification:{...result.verification,reason:null}}:{}),
    evidence:{...current,worldStatus:invalidateWorld?'unconfirmed':current.worldStatus,
      reason:complete?null:visual.reason||'VISUAL_EVIDENCE_MISMATCH',dimensions:categories,
      ...(invalidateWorld?{persistence:{required:current.persistence.required,status:current.persistence.required?'unverified':'not-required'}}:{})}};
}
