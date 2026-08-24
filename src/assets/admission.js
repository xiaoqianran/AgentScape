const STATUS_ORDER=Object.freeze({ready:0,provisional:1,rejected:2});
const VALID_STATUS=new Set(Object.keys(STATUS_ORDER));
const REASON_RE=/^[A-Z0-9][A-Z0-9._:-]{0,127}$/;

const clone=(value)=>value==null?value:structuredClone(value);
const unique=(values)=>[...new Set(values.filter(Boolean))];
const reasonCodes=(items=[])=>unique((items||[]).map((item)=>typeof item==='string'?item:item?.code).filter((code)=>typeof code==='string'&&REASON_RE.test(code)));
const normalizeReasons=(reasons=[])=>unique((Array.isArray(reasons)?reasons:[]).map((code)=>String(code||'').trim()).filter((code)=>REASON_RE.test(code)));
const worse=(a,b)=>STATUS_ORDER[a]>=STATUS_ORDER[b]?a:b;
const layer=(status='ready',reasons=[],required=false)=>({status,reasons:unique(reasons),required:Boolean(required)});

const isProviderReason=(code)=>code==='PART_SEMANTICS_UNVERIFIED'||code.startsWith('PROVIDER_')||code==='FALLBACK_BOX_COLLIDER'||code==='UNVERIFIED_PROVIDER_SEMANTICS';
const isRuntimeReason=(code)=>code.startsWith('ARTICULATION_')||code.startsWith('RUNTIME_');

function sameAdmissionSnapshot(a,b) {
  if (!a||!b||a.status!==b.status) return false;
  const ar=normalizeReasons(a.reasons),br=normalizeReasons(b.reasons);
  return ar.length===br.length&&ar.every((code,index)=>code===br[index]);
}

function providerAdmissionEvidence(manifest) {
  const provenance=manifest?.provenance||{};
  if (provenance.providerAdmission) return provenance.providerAdmission;
  const legacy=provenance.admission;
  if (!legacy) return null;
  // AS-05 before AS-08 wrote the aggregate result to both provenance.admission
  // and provenance.assetProduction.admission. That value is a stale aggregate
  // snapshot, not provider-layer authority, so ignore it here.
  if (sameAdmissionSnapshot(legacy,provenance.assetProduction?.admission)) return null;
  return legacy;
}

function providerEvidenceReasons(manifest) {
  const levels=manifest?.provenance?.providerEvidence?.levels;
  if (!levels) return [];
  const reasons=[];
  if (levels.partSemantics==='provider-unverified') reasons.push('PART_SEMANTICS_UNVERIFIED');
  if (levels.grasps==='raw-provider-unverified'||levels.grasps==='sapien-provider-unverified') reasons.push('PROVIDER_GRASP_UNVERIFIED');
  if (levels.grasps==='raw-provider-only') reasons.push('PROVIDER_GRASP_RAW_ONLY');
  if (levels.grasps==='sapien-validated-provider-only') reasons.push('PROVIDER_GRASP_SAPIEN_ONLY');
  return unique(reasons);
}

function providerLayer(manifest,allQualityCodes) {
  const explicit=providerAdmissionEvidence(manifest);
  const evidenceReasons=providerEvidenceReasons(manifest);
  const qualityReasons=allQualityCodes.filter(isProviderReason);
  const reasons=unique([...normalizeReasons(explicit?.reasons),...qualityReasons,...evidenceReasons]);
  const required=Boolean(explicit||manifest?.provenance?.providerEvidence||manifest?.provenance?.provider);
  let status='ready';
  if (explicit) {
    const requested=String(explicit.status||'').trim();
    if (!VALID_STATUS.has(requested)) return layer('provisional',unique([...reasons,'PROVIDER_ADMISSION_INVALID']),true);
    status=requested;
  }
  if (qualityReasons.length||evidenceReasons.length) status=worse(status,'provisional');
  if (status==='rejected'&&!reasons.length) reasons.push('PROVIDER_REJECTED');
  if (status==='provisional'&&!reasons.length) reasons.push('PROVIDER_PROVISIONAL');
  return layer(status,reasons,required);
}

function compilerLayer(manifest,{generated,hardCodes,advisoryCodes}) {
  const quality=manifest?.compiler?.quality;
  const required=Boolean(generated||quality);
  if (!quality) return generated?layer('provisional',['COMPILER_UNVERIFIED'],true):layer('ready',[],false);
  const compilerHard=hardCodes.filter((code)=>!isProviderReason(code)&&!isRuntimeReason(code));
  const compilerAdvisory=advisoryCodes.filter((code)=>!isProviderReason(code)&&!isRuntimeReason(code));
  const declared=String(quality.status||'').trim();
  if (hardCodes.length||declared==='rejected') {
    return layer('rejected',unique(['COMPILER_REJECTED',...compilerHard]),true);
  }
  if (!VALID_STATUS.has(declared)) return layer('provisional',['COMPILER_UNVERIFIED'],true);
  if (compilerAdvisory.length) return layer('provisional',compilerAdvisory,true);
  if (declared==='provisional' && !advisoryCodes.length) return layer('provisional',['COMPILER_PROVISIONAL'],true);
  // A provisional quality status caused only by provider/runtime advisories means
  // the compiler layer itself is ready; those blockers belong to their own layers.
  return layer('ready',[],required);
}

function executableArticulation(manifest) {
  return Object.values(manifest?.parts||{}).some((part)=>part?.joint&&Object.keys(part.targets||{}).length>0);
}

function runtimeLayer(manifest,{advisoryCodes,hardCodes}) {
  const verification=manifest?.verification?.articulation;
  const qualityRuntimeReasons=unique([...hardCodes,...advisoryCodes].filter(isRuntimeReason));
  const required=Boolean(verification||qualityRuntimeReasons.length||executableArticulation(manifest));
  if (!required) return layer('ready',[],false);
  if (verification?.ok===true) return layer('ready',[],true);
  if (verification?.ok===false) {
    return layer('provisional',unique([...qualityRuntimeReasons.filter((code)=>code!=='ARTICULATION_UNVERIFIED'),'ARTICULATION_VERIFICATION_FAILED']),true);
  }
  return layer('provisional',qualityRuntimeReasons.length?qualityRuntimeReasons:['ARTICULATION_UNVERIFIED'],true);
}

export function assetAdmission(manifest,{generated=false}={}) {
  const quality=manifest?.compiler?.quality;
  const hardCodes=reasonCodes(quality?.hard);
  const advisoryCodes=reasonCodes(quality?.advisory);
  const allQualityCodes=unique([...hardCodes,...advisoryCodes]);

  const layers={
    provider:providerLayer(manifest,allQualityCodes),
    compiler:compilerLayer(manifest,{generated,hardCodes,advisoryCodes}),
    runtime:runtimeLayer(manifest,{advisoryCodes,hardCodes})
  };

  let status='ready';
  for (const current of Object.values(layers)) status=worse(status,current.status);
  const reasons=unique(Object.values(layers).flatMap((current)=>current.status==='ready'?[]:current.reasons));

  // Preserve repo/builtin legacy readiness when no admission layer is required.
  if (!generated&&!layers.provider.required&&!layers.compiler.required&&!layers.runtime.required) {
    return {status:'ready',reasons:[],layers:clone(layers)};
  }
  return {status,reasons,layers:clone(layers)};
}
