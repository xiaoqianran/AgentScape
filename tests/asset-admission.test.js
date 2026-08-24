import { describe, expect, it } from 'vitest';
import { assetAdmission } from '../src/assets/admission.js';

describe('assetAdmission',()=>{
  it('keeps repo assets ready but generated manifests provisional unless trusted evidence says otherwise',()=>{
    expect(assetAdmission({source:{kind:'builtin'}})).toEqual({status:'ready',reasons:[]});
    expect(assetAdmission({source:{kind:'glb'}},{generated:true})).toEqual({status:'provisional',reasons:['UNVERIFIED_GENERATOR_MANIFEST']});
    expect(assetAdmission({compiler:{quality:{status:'ready'}}},{generated:true})).toEqual({status:'ready',reasons:[]});
    expect(assetAdmission({compiler:{quality:{status:'provisional'}}})).toEqual({status:'provisional',reasons:['COMPILER_PROVISIONAL']});
    expect(assetAdmission({compiler:{quality:{status:'rejected'}}})).toEqual({status:'rejected',reasons:['COMPILER_REJECTED']});
  });

  it('surfaces compiler advisory codes as admission reasons for versioned provider evidence',()=>{
    const manifest={
      compiler:{quality:{status:'provisional',advisory:[{code:'PART_SEMANTICS_UNVERIFIED'},{code:'PROVIDER_GRASP_RAW_ONLY'}]}},
      provenance:{provider:'embodiedgen',providerEvidence:{bundleVersion:1}}
    };
    expect(assetAdmission(manifest)).toEqual({status:'provisional',reasons:['PART_SEMANTICS_UNVERIFIED','PROVIDER_GRASP_RAW_ONLY']});
  });

  it('prefers explicit provider admission over inferred compiler/default status',()=>{
    expect(assetAdmission({compiler:{quality:{status:'ready'}},provenance:{admission:{status:'provisional',reasons:['PROVIDER_UNVERIFIED']}}})).toEqual({status:'provisional',reasons:['PROVIDER_UNVERIFIED']});
  });
});
