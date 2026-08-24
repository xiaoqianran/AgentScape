import { describe, expect, it } from 'vitest';
import { assetAdmission } from '../src/assets/admission.js';

const q=(status,{hard=[],advisory=[]}={})=>({compiler:{quality:{status,hard,advisory}}});
const p=(status,reasons=[])=>({provenance:{provider:'provider-x',admission:{status,reasons}}});
const merge=(...items)=>items.reduce((out,item)=>({
  ...out,...item,
  provenance:{...(out.provenance||{}),...(item.provenance||{})},
  compiler:{...(out.compiler||{}),...(item.compiler||{})},
  verification:{...(out.verification||{}),...(item.verification||{})}
}),{});

describe('assetAdmission layered contract',()=>{
  it('keeps repo assets ready but generated manifests without compiler evidence provisional',()=>{
    expect(assetAdmission({source:{kind:'builtin'}})).toMatchObject({
      status:'ready',reasons:[],
      layers:{provider:{status:'ready',required:false},compiler:{status:'ready',required:false},runtime:{status:'ready',required:false}}
    });
    expect(assetAdmission({source:{kind:'glb'}},{generated:true})).toMatchObject({
      status:'provisional',reasons:['COMPILER_UNVERIFIED'],layers:{compiler:{status:'provisional',required:true,reasons:['COMPILER_UNVERIFIED']}}
    });
    expect(assetAdmission(q('ready'),{generated:true})).toMatchObject({status:'ready',reasons:[],layers:{compiler:{status:'ready'}}});
    expect(assetAdmission(q('provisional'))).toMatchObject({status:'provisional',reasons:['COMPILER_PROVISIONAL']});
    expect(assetAdmission(q('rejected'))).toMatchObject({status:'rejected',reasons:['COMPILER_REJECTED']});
  });

  it('surfaces provider quality advisory codes in the provider layer, not compiler layer',()=>{
    const manifest={
      compiler:{quality:{status:'provisional',hard:[],advisory:[{code:'PART_SEMANTICS_UNVERIFIED'},{code:'PROVIDER_GRASP_RAW_ONLY'}]}},
      provenance:{provider:'embodiedgen',providerEvidence:{bundleVersion:1}}
    };
    expect(assetAdmission(manifest)).toMatchObject({
      status:'provisional',reasons:['PART_SEMANTICS_UNVERIFIED','PROVIDER_GRASP_RAW_ONLY'],
      layers:{
        provider:{status:'provisional',reasons:['PART_SEMANTICS_UNVERIFIED','PROVIDER_GRASP_RAW_ONLY']},
        compiler:{status:'ready',reasons:[]},runtime:{status:'ready'}
      }
    });
  });

  it('treats explicit provenance admission as provider-layer evidence instead of aggregate authority',()=>{
    const result=assetAdmission(merge(q('ready'),p('provisional',['PROVIDER_UNVERIFIED'])));
    expect(result).toMatchObject({
      status:'provisional',reasons:['PROVIDER_UNVERIFIED'],
      layers:{provider:{status:'provisional'},compiler:{status:'ready'}}
    });
  });

  it('uses worst-layer wins across provider and compiler',()=>{
    expect(assetAdmission(merge(p('ready'),q('rejected')))).toMatchObject({status:'rejected',layers:{provider:{status:'ready'},compiler:{status:'rejected'}}});
    expect(assetAdmission(merge(p('provisional',['PROVIDER_WAIT']),q('rejected')))).toMatchObject({
      status:'rejected',reasons:expect.arrayContaining(['PROVIDER_WAIT','COMPILER_REJECTED'])
    });
    expect(assetAdmission(merge(p('rejected',['PROVIDER_REJECT']),q('ready')))).toMatchObject({status:'rejected',reasons:['PROVIDER_REJECT']});
    expect(assetAdmission(merge(p('provisional',['PROVIDER_WAIT']),q('ready')))).toMatchObject({status:'provisional'});
    expect(assetAdmission(merge(p('ready'),q('provisional',{advisory:[{code:'COLLIDER_COARSE'}]})))).toMatchObject({
      status:'provisional',reasons:['COLLIDER_COARSE'],layers:{compiler:{status:'provisional'}}
    });
  });

  it('cannot let provider ready override compiler hard rejection',()=>{
    const result=assetAdmission(merge(p('ready'),q('ready',{hard:[{code:'GLB_PARSE_FAILED'}]})));
    expect(result.status).toBe('rejected');
    expect(result.reasons).toEqual(['COMPILER_REJECTED','GLB_PARSE_FAILED']);
  });

  it('requires runtime articulation verification independently from provider/compiler readiness',()=>{
    const manifest=merge(p('ready'),q('provisional',{advisory:[{code:'ARTICULATION_UNVERIFIED'}]}));
    manifest.parts={door:{joint:{type:'revolute'},targets:{open:-1}}};
    expect(assetAdmission(manifest)).toMatchObject({
      status:'provisional',reasons:['ARTICULATION_UNVERIFIED'],
      layers:{provider:{status:'ready'},compiler:{status:'ready'},runtime:{status:'provisional',required:true}}
    });
    manifest.verification={articulation:{ok:true}};
    expect(assetAdmission(manifest)).toMatchObject({status:'ready',reasons:[],layers:{runtime:{status:'ready',required:true}}});
  });

  it('keeps failed runtime articulation verification provisional',()=>{
    const manifest=merge(p('ready'),q('provisional',{advisory:[{code:'ARTICULATION_VERIFICATION_FAILED'}]}));
    manifest.parts={door:{joint:{type:'revolute'},targets:{open:-1}}};
    manifest.verification={articulation:{ok:false}};
    expect(assetAdmission(manifest)).toMatchObject({
      status:'provisional',reasons:['ARTICULATION_VERIFICATION_FAILED'],layers:{runtime:{status:'provisional',required:true}}
    });
  });

  it('does not let provider/SAPIEN grasp evidence satisfy runtime articulation readiness',()=>{
    const manifest={
      provenance:{provider:'embodiedgen',providerEvidence:{levels:{grasps:'sapien-validated-provider-only'}}},
      compiler:{quality:{status:'provisional',hard:[],advisory:[{code:'PROVIDER_GRASP_SAPIEN_ONLY'},{code:'ARTICULATION_UNVERIFIED'}]}},
      parts:{door:{joint:{type:'revolute'},targets:{open:-1}}}
    };
    const result=assetAdmission(manifest);
    expect(result).toMatchObject({
      status:'provisional',
      layers:{provider:{status:'provisional'},compiler:{status:'ready'},runtime:{status:'provisional'}}
    });
    expect(result.reasons).toEqual(['PROVIDER_GRASP_SAPIEN_ONLY','ARTICULATION_UNVERIFIED']);
  });

  it('ignores legacy AS-05 aggregate admission snapshots when assetProduction has the same snapshot',()=>{
    const manifest={
      compiler:{quality:{status:'ready',hard:[],advisory:[]}},
      provenance:{
        admission:{status:'provisional',reasons:['COMPILER_PROVISIONAL']},
        assetProduction:{admission:{status:'provisional',reasons:['COMPILER_PROVISIONAL']},sourceArtifact:{id:'artifact_01',hash:'sha256:x'}}
      }
    };
    expect(assetAdmission(manifest)).toMatchObject({status:'ready',reasons:[],layers:{provider:{required:false},compiler:{status:'ready'}}});
  });

  it('deduplicates stable reasons across layers',()=>{
    const manifest=merge(p('provisional',['PROVIDER_WAIT','PROVIDER_WAIT']),q('provisional',{advisory:[{code:'COLLIDER_COARSE'},{code:'COLLIDER_COARSE'}]}));
    expect(assetAdmission(manifest).reasons).toEqual(['PROVIDER_WAIT','COLLIDER_COARSE']);
  });
});
