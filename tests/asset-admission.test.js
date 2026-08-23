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

  it('prefers explicit provider admission over inferred compiler/default status',()=>{
    expect(assetAdmission({compiler:{quality:{status:'ready'}},provenance:{admission:{status:'provisional',reasons:['PROVIDER_UNVERIFIED']}}})).toEqual({status:'provisional',reasons:['PROVIDER_UNVERIFIED']});
  });
});
