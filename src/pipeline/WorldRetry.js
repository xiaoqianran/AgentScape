const executionRequests=(state,worldIR)=>state.artifacts?.compilation?.entities || worldIR.entities.map((entity)=>({
  ...(entity.id?{id:entity.id}:{}),...structuredClone(entity.asset)
}));

export function buildWorldRetryPlan(pipeline,{generatorConfigured=false,attempt=1,budget=2}={}) {
  const state=pipeline?.state || {};
  const reports=state.reports || {};
  const worldIR=state.artifacts?.worldIR?.schema==='agentscape.world-ir' ? structuredClone(state.artifacts.worldIR) : null;
  if(!worldIR){
    return {
      schema:'agentscape.world-retry.v1',attempt,budget,status:'not-retriable',retriable:false,actions:[],
      findings:[{stage:'pipeline',code:'WORLD_IR_REQUIRED',retriable:false}]
    };
  }

  const requests=executionRequests(state,worldIR);
  const findings=[];
  const actions=[];

  for (const unresolved of reports.assetAdmission?.unresolved || []) {
    const request=requests.find((item)=>(unresolved.id && item.id===unresolved.id) || (!unresolved.id && item.query===unresolved.query));
    const canGenerate=Boolean(generatorConfigured && unresolved.status==='missing' && request && request.generate!==true);
    findings.push({
      stage:'asset',code:unresolved.status || 'ASSET_UNRESOLVED',
      instanceId:unresolved.id || request?.id || null,query:unresolved.query || request?.query || null,
      retriable:canGenerate
    });
    if (canGenerate) actions.push({kind:'enable-generation',instanceId:request.id || null,query:request.query});
  }

  const layout=reports.layoutAdmission;
  if (layout?.status==='rejected') {
    findings.push({stage:'layout',code:layout.reason || 'LAYOUT_REJECTED',retriable:false,issues:structuredClone(layout.issues || [])});
  }

  const relations=reports.relationAdmission;
  if (relations?.status==='rejected') {
    findings.push({stage:'relation',code:relations.reason || 'RELATION_REJECTED',retriable:false,issues:structuredClone(relations.issues || [])});
  }

  const validation=reports.validationAfterRepair || reports.validation;
  const reachedRepair=[
    reports.assetAdmission,reports.layoutAdmission,reports.behaviorAdmission,reports.physicsAdmission,reports.relationAdmission
  ].every((admission)=>admission?.status!=='rejected');
  if (reachedRepair && validation?.counts?.hard) {
    findings.push({
      stage:'validation',code:'VALIDATION_HARD',count:validation.counts.hard,retriable:false,
      findings:(validation.hard || []).map((item)=>({code:item.code,object:item.object || null,other:item.other || null}))
    });
  }

  const base={schema:'agentscape.world-retry.v1',attempt,budget,findings,actions};
  if (attempt>=budget) return {...base,status:'exhausted',retriable:false};
  if (!findings.length || findings.some((item)=>!item.retriable) || !actions.length) {
    return {...base,status:'not-retriable',retriable:false};
  }

  const nextIR=structuredClone(worldIR);
  nextIR.revision={
    id:`${worldIR.revision.id}:retry-${attempt+1}`,
    parentId:worldIR.revision.id,
    reason:'bounded missing-asset regeneration'
  };
  nextIR.provenance={
    ...nextIR.provenance,
    source:'world-retry',
    sourceId:worldIR.revision.id,
    evidenceRefs:[...(worldIR.provenance.evidenceRefs||[]),...findings.filter((item)=>item.stage==='asset').map((item)=>item.instanceId||item.query).filter(Boolean)]
  };
  for (const action of actions) {
    const request=nextIR.entities.find((item)=>(action.instanceId && item.id===action.instanceId) || (!action.instanceId && item.asset?.query===action.query));
    if (request) request.asset.generate=true;
  }
  return {...base,status:'retry-proposed',retriable:true,nextIR};
}
