import { describe, expect, it } from 'vitest';
import { assertFindingRevision, compileAcceptanceFindings, compileAdmissionFindings, compileValidationFindings } from '../src/validation/Finding.js';

describe('Finding contract',()=>{
  it('converts validator rows into revision-bound typed findings with explicit repair eligibility',()=>{
    const findings=compileValidationFindings({hard:[{code:'G_BELOW_GROUND',object:'box',message:'below',measure:-.2},{code:'R_ASYMMETRIC',object:'cup',other:'table'}],advisory:[]},{worldRevisionId:'rev-3'});
    expect(findings[0]).toMatchObject({schema:'agentscape.finding',schemaVersion:1,source:'world-validator',severity:'hard',code:'G_BELOW_GROUND',worldRevisionId:'rev-3',affectedObjects:['box'],repair:{eligible:true,strategy:'lift_to_ground'}});
    expect(findings[1].repair).toEqual({eligible:false});
  });
  it('turns failed acceptance checks into non-repairable hard findings',()=>{
    const findings=compileAcceptanceFindings({checks:[{id:'door-open',verified:false,reason:'INTERACTION_NOT_VERIFIED',targetId:'door'}]},{worldRevisionId:'rev-4'});
    expect(findings[0]).toMatchObject({source:'world-acceptance',severity:'hard',code:'A_INTERACTION_NOT_VERIFIED',worldRevisionId:'rev-4',affectedObjects:['door'],repair:{eligible:false}});
  });
  it('turns admission issues into revision-bound non-repairable scope evidence',()=>{
    const behavior=compileAdmissionFindings({status:'rejected',issues:[{code:'BEHAVIOR_CAPABILITY_INTENT_UNSUPPORTED',targetId:'door',capability:'OPEN',assetId:'static-door'}]},{stage:'behavior',worldRevisionId:'rev-5'});
    expect(behavior[0]).toMatchObject({
      source:'world-behavior-admission',severity:'hard',code:'BEHAVIOR_CAPABILITY_INTENT_UNSUPPORTED',worldRevisionId:'rev-5',
      affectedObjects:['door'],repair:{eligible:false},evidence:{stage:'behavior',capability:'OPEN',assetId:'static-door'}
    });
    const missing=compileAdmissionFindings({status:'rejected',unresolved:[{id:'fixture_01',query:'rare fixture',status:'missing'}]},{stage:'asset',worldRevisionId:'rev-5'});
    expect(missing[0]).toMatchObject({code:'ASSET_MISSING',affectedObjects:['fixture_01'],evidence:{query:'rare fixture',status:'missing'}});
  });
  it('rejects findings from a stale world revision before repair',()=>{
    expect(()=>assertFindingRevision([compileValidationFindings({hard:[{code:'G_BELOW_GROUND',object:'box'}],advisory:[]},{worldRevisionId:'rev-old'})[0]],'rev-new')).toThrow(/revision mismatch/);
  });
});
