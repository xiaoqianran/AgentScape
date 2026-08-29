export const FINDING_SCHEMA='agentscape.finding';
export const FINDING_VERSION=1;

const clone=(value)=>value==null?value:structuredClone(value);
const clean=(value)=>typeof value==='string'?value.trim():'';
const REPAIR_STRATEGY={
  G_BELOW_GROUND:'lift_to_ground',
  P_OVERLAP:'separate_overlap'
};

export function normalizeFinding(input,{index=0}={}){
  if(!input||typeof input!=='object'||Array.isArray(input)) throw new TypeError('Finding must be an object');
  if(input.schema!==FINDING_SCHEMA||input.schemaVersion!==FINDING_VERSION) throw new TypeError('Unsupported Finding contract');
  const id=clean(input.id),source=clean(input.source),severity=clean(input.severity),code=clean(input.code);
  if(!id||!source||!code||!['hard','advisory'].includes(severity)) throw new TypeError(`Finding[${index}] requires id/source/severity/code`);
  const affectedObjects=Array.isArray(input.affectedObjects)?[...new Set(input.affectedObjects.map(clean).filter(Boolean))]:[];
  const repair=input.repair&&typeof input.repair==='object'&&!Array.isArray(input.repair)?{
    eligible:input.repair.eligible===true,
    ...(clean(input.repair.strategy)?{strategy:clean(input.repair.strategy)}:{})
  }:{eligible:false};
  if(repair.eligible&&!repair.strategy) throw new TypeError(`Finding ${id} repairable finding requires strategy`);
  return {
    schema:FINDING_SCHEMA,schemaVersion:FINDING_VERSION,id,source,severity,code,
    ...(clean(input.worldRevisionId)?{worldRevisionId:clean(input.worldRevisionId)}:{}),
    affectedObjects,
    message:clean(input.message),
    evidence:clone(input.evidence||{}),
    repair
  };
}

export function compileValidationFindings(report,{worldRevisionId=null}={}){
  const rows=[
    ...(report?.hard||[]).map((raw)=>({severity:'hard',raw})),
    ...(report?.advisory||[]).map((raw)=>({severity:'advisory',raw}))
  ];
  return rows.map(({severity,raw},index)=>{
    const affectedObjects=[raw.object,raw.other].map(clean).filter(Boolean);
    const strategy=REPAIR_STRATEGY[raw.code]||null;
    return normalizeFinding({
      schema:FINDING_SCHEMA,schemaVersion:FINDING_VERSION,
      id:`validation:${severity}:${raw.code||'UNKNOWN'}:${affectedObjects.join('+')||'$world'}:${index}`,
      source:'world-validator',severity,code:raw.code||'UNKNOWN',
      ...(worldRevisionId?{worldRevisionId}:{}),affectedObjects,
      message:raw.message||'',evidence:{...clone(raw)},
      repair:{eligible:Boolean(strategy),...(strategy?{strategy}:{})}
    },{index});
  });
}


const admissionCode=(stage,item,report)=>{
  const explicit=clean(item?.code||item?.reason||report?.reason);
  if(explicit) return explicit.toUpperCase().replace(/[^A-Z0-9_]+/g,'_');
  const status=clean(item?.status);
  if(stage==='asset'&&status) return `ASSET_${status.toUpperCase().replace(/[^A-Z0-9_]+/g,'_')}`;
  return `${clean(stage).toUpperCase()||'WORLD'}_ADMISSION_REJECTED`;
};

const admissionAffectedObjects=(item)=>[item?.entityId,item?.targetId,item?.supportId,item?.subject,item?.object,item?.instanceId,item?.id]
  .map(clean).filter(Boolean);

export function compileAdmissionFindings(report,{stage='world',worldRevisionId=null}={}){
  if(report?.status!=='rejected') return [];
  const issues=Array.isArray(report.issues)&&report.issues.length ? report.issues
    : Array.isArray(report.unresolved)&&report.unresolved.length ? report.unresolved
    : [{}];
  return issues.map((item,index)=>{
    const code=admissionCode(stage,item,report);
    const affectedObjects=[...new Set(admissionAffectedObjects(item))];
    return normalizeFinding({
      schema:FINDING_SCHEMA,schemaVersion:FINDING_VERSION,
      id:`${clean(stage)||'world'}:hard:${code}:${affectedObjects.join('+')||'$world'}:${index}`,
      source:`world-${clean(stage)||'world'}-admission`,severity:'hard',code,
      ...(worldRevisionId?{worldRevisionId}:{}),affectedObjects,
      message:`${clean(stage)||'world'} admission rejected: ${code}`,
      evidence:{stage:clean(stage)||'world',...clone(item),...(report?.reason?{admissionReason:report.reason}:{})},
      repair:{eligible:false}
    },{index});
  });
}

export function compileAcceptanceFindings(result,{worldRevisionId=null}={}){
  return (result?.checks||[]).filter((check)=>check?.verified===false).map((check,index)=>normalizeFinding({
    schema:FINDING_SCHEMA,schemaVersion:FINDING_VERSION,
    id:`acceptance:hard:${check.id||check.kind||'check'}:${index}`,
    source:'world-acceptance',severity:'hard',code:`A_${check.reason||'NOT_VERIFIED'}`,
    ...(worldRevisionId?{worldRevisionId}:{}),
    affectedObjects:[check.targetId,check.subject,check.object].filter(Boolean),
    message:`Acceptance criterion not verified: ${check.id||check.kind||'unknown'}`,
    evidence:clone(check),repair:{eligible:false}
  },{index}));
}

export function assertFindingRevision(findings,currentWorldRevisionId){
  for(const finding of findings.map((item,index)=>normalizeFinding(item,{index}))){
    if(finding.worldRevisionId&&currentWorldRevisionId&&finding.worldRevisionId!==currentWorldRevisionId){
      const error=new Error(`Finding revision mismatch: ${finding.worldRevisionId} != ${currentWorldRevisionId}`);
      error.code='FINDING_REVISION_MISMATCH';
      error.findingId=finding.id;
      throw error;
    }
  }
  return true;
}
