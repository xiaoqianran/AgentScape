// A visual composition can deliberately contain joined parts and floating subjects.
// This acknowledges broad-phase findings; it never proves physical contact or
// changes the WorldValidator report, physics, or the default world-valid check.
const clean=value=>typeof value==='string'?value.trim():'';
const pairKey=(a,b)=>JSON.stringify([a,b].sort());
const validId=value=>clean(value)&&value.length<=100;
const normalize=(items,pair)=>{
  if(items===undefined)return [];
  if(!Array.isArray(items)||items.length>64)throw new TypeError('Visual layout declarations must be bounded arrays (max 64)');
  const seen=new Set();
  return items.map(item=>{
    if(!item||typeof item!=='object'||Array.isArray(item)||Object.keys(item).some(key=>!(pair?['object','other','reason']:['object','reason']).includes(key)))throw new TypeError('Invalid visual layout declaration');
    const object=clean(item.object),other=clean(item.other),reason=clean(item.reason);
    if(!validId(object)||(pair&&(!validId(other)||object===other))||!reason||reason.length>200)throw new TypeError('Visual layout declaration requires distinct object IDs and reason');
    const key=pair?pairKey(object,other):object;
    if(seen.has(key))throw new TypeError('Duplicate visual layout declaration');
    seen.add(key);
    return {object,...(pair?{other}:{}),reason};
  });
};

export function compileVisualLayout(item){
  return {expectedOverlaps:normalize(item.expectedOverlaps,true),expectedFloating:normalize(item.expectedFloating,false)};
}

export function evaluateVisualLayout(runtime,check,validation){
  const base={id:check.id,kind:check.kind};
  if(!Array.isArray(validation?.hard)||!Array.isArray(validation?.advisory))return {...base,verified:false,reason:'VISUAL_LAYOUT_EVIDENCE_MISSING'};
  const visual=id=>{
    if(!runtime?.store?.has?.(id))return false;
    const record=runtime.store.get(id);
    return record?.active!==false&&record?.manifest?.capabilityLevel==='visual'&&
      typeof runtime.physics?.getPosition==='function'&&runtime.physics.getPosition(id)==null;
  };
  const overlaps=new Map(check.expectedOverlaps.map(d=>[pairKey(d.object,d.other),d]));
  const floating=new Map(check.expectedFloating.map(d=>[d.object,d]));
  const acknowledged=[],unexpectedHard=[],unexpectedAdvisory=[],invalidDeclarations=[];
  for(const d of check.expectedOverlaps)if(!visual(d.object)||!visual(d.other))invalidDeclarations.push(d);
  for(const d of check.expectedFloating)if(!visual(d.object))invalidDeclarations.push(d);
  for(const finding of validation.hard){
    const key=pairKey(finding.object,finding.other),d=overlaps.get(key);
    if(finding.code==='P_OVERLAP'&&d&&visual(d.object)&&visual(d.other)){
      acknowledged.push({finding,declaration:d});overlaps.delete(key);
    }else unexpectedHard.push(finding);
  }
  for(const finding of validation.advisory){
    const d=floating.get(finding.object);
    if(finding.code==='G_FLOATING'&&d&&visual(d.object)){
      acknowledged.push({finding,declaration:d});floating.delete(finding.object);
    }else unexpectedAdvisory.push(finding);
  }
  // Unused declarations are explicit stale evidence, not an open-ended waiver.
  const unmatchedDeclarations=[...overlaps.values(),...floating.values()];
  const verified=unexpectedHard.length===0&&unexpectedAdvisory.length===0&&invalidDeclarations.length===0&&unmatchedDeclarations.length===0;
  return {...base,verified,...(!verified?{reason:'VISUAL_LAYOUT_UNEXPECTED_FINDINGS'}:{}),evidence:structuredClone({
    scope:'visual-layout-only',validation,acknowledged,unexpectedHard,unexpectedAdvisory,invalidDeclarations,unmatchedDeclarations
  })};
}
