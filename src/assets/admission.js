export function assetAdmission(manifest, { generated = false } = {}) {
  const explicit=manifest?.provenance?.admission;
  if (explicit?.status) return {status:explicit.status,reasons:[...(explicit.reasons || [])]};
  const compilerStatus=manifest?.compiler?.quality?.status;
  if (compilerStatus==='ready') return {status:'ready',reasons:[]};
  if (compilerStatus==='provisional') {
    const providerEvidence=manifest?.provenance?.providerEvidence;
    const advisoryCodes=(manifest?.compiler?.quality?.advisory || []).map((item)=>item?.code).filter(Boolean);
    return {status:'provisional',reasons:providerEvidence && advisoryCodes.length ? [...new Set(advisoryCodes)] : ['COMPILER_PROVISIONAL']};
  }
  if (compilerStatus==='rejected') return {status:'rejected',reasons:['COMPILER_REJECTED']};
  if (generated) return {status:'provisional',reasons:['UNVERIFIED_GENERATOR_MANIFEST']};
  return {status:'ready',reasons:[]};
}
