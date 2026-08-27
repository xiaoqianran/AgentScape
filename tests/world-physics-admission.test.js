import { describe,expect,it } from 'vitest';
import { PhysicsBackend } from '../src/runtime/physics/PhysicsBackend.js';
import { compileWorldPhysicsRequirements,admitWorldPhysics } from '../src/pipeline/WorldPhysicsAdmission.js';

const ir=(physicsRequirement)=>({revision:{id:'rev-p'},policy:{physics:{fallbackPolicy:'deny'}},entities:[{id:'door',physicsRequirement}]});
const backend=(caps=['rigid-body','articulated-body','joints','collision'])=>new PhysicsBackend('test',caps,{executionModes:['realtime','validation-only'],qualities:{realtime:true,deterministic:true}});

describe('WorldPhysicsAdmission',()=>{
  it('compiles body class into backend-neutral capabilities and admits matching articulated assets',()=>{
    const bundle=compileWorldPhysicsRequirements(ir({bodyClass:'articulated',requiredCapabilities:['collision'],executionMode:'realtime',qualityPolicy:{deterministicRequired:true}}));
    expect(bundle).toMatchObject({schema:'agentscape.world-physics-requirements',worldRevisionId:'rev-p',requirements:[{entityId:'door',bodyClass:'articulated',requiredCapabilities:['articulated-body','joints','collision'],executionMode:'realtime'}]});
    const result=admitWorldPhysics(bundle,{backend:backend(),resolvedAssets:[{id:'door',assetRef:{assetId:'cabinet'}}],getManifest:()=>({parts:{door:{joint:{type:'revolute'}}}})});
    expect(result).toMatchObject({status:'ready',backend:{identity:'test',qualities:{deterministic:true,realtime:true}},issues:[]});
  });
  it('fails closed when the authoritative backend lacks a required capability',()=>{
    const bundle=compileWorldPhysicsRequirements(ir({bodyClass:'soft',requiredCapabilities:[],executionMode:'realtime'}));
    expect(admitWorldPhysics(bundle,{backend:backend(),resolvedAssets:[{id:'door',assetRef:{assetId:'cloth'}}],getManifest:()=>({})})).toMatchObject({status:'rejected',issues:[{code:'PHYSICS_BACKEND_CAPABILITY_MISSING',entityId:'door',capability:'soft-body'}]});
  });
  it('fails closed when declared quality or articulated evidence is missing',()=>{
    const b=new PhysicsBackend('weak',['articulated-body','joints'],{executionModes:['realtime'],qualities:{realtime:true,deterministic:false}});
    const bundle=compileWorldPhysicsRequirements(ir({bodyClass:'articulated',executionMode:'realtime',qualityPolicy:{deterministicRequired:true}}));
    const result=admitWorldPhysics(bundle,{backend:b,resolvedAssets:[{id:'door',assetRef:{assetId:'cabinet'}}],getManifest:()=>({parts:{}})});
    expect(result.issues).toEqual(expect.arrayContaining([expect.objectContaining({code:'PHYSICS_DETERMINISM_QUALITY_UNMET'}),expect.objectContaining({code:'PHYSICS_ASSET_ARTICULATION_MISSING'})]));
  });
  it('admits an empty requirement set even without a backend',()=>{
    expect(admitWorldPhysics(compileWorldPhysicsRequirements({revision:{id:'r'},policy:{physics:{}},entities:[]}),{backend:null})).toMatchObject({status:'ready',issues:[]});
  });
});
