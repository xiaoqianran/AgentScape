export function assetAdmission(manifest, { generated = false } = {}) {
  const explicit=manifest?.provenance?.admission;
  if (explicit?.status) return {status:explicit.status,reasons:[...(explicit.reasons || [])]};
  const compilerStatus=manifest?.compiler?.quality?.status;
  if (compilerStatus==='ready') return {status:'ready',reasons:[]};
  if (compilerStatus==='provisional') return {status:'provisional',reasons:['COMPILER_PROVISIONAL']};
  if (compilerStatus==='rejected') return {status:'rejected',reasons:['COMPILER_REJECTED']};
  if (generated) return {status:'provisional',reasons:['UNVERIFIED_GENERATOR_MANIFEST']};
  return {status:'ready',reasons:[]};
}
