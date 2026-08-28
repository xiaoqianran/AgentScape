import { describe,expect,it } from 'vitest';
import { PhysicsBackend, TransformPhysicsBackend } from '../src/runtime/physics/PhysicsBackend.js';
import { PhysicsSystem } from '../src/runtime/systems/PhysicsSystem.js';
import { compileWorldPhysicsRequirements,admitWorldPhysics } from '../src/pipeline/WorldPhysicsAdmission.js';

const ir=(physicsRequirement)=>({revision:{id:'rev-p'},policy:{physics:{fallbackPolicy:'deny'}},entities:[{id:'door',physicsRequirement}]});
const backend=(caps=['rigid-body','articulated-body','joints','collision'])=>new PhysicsBackend('test',caps,{executionModes:['realtime','validation-only'],qualities:{realtime:true,deterministic:true}});
const profileOf=(backend)=>new PhysicsSystem({backend}).profile();

describe('WorldPhysicsAdmission',()=>{
  it('compiles body class into backend-neutral capabilities and admits matching articulated assets',()=>{
    const bundle=compileWorldPhysicsRequirements(ir({bodyClass:'articulated',requiredCapabilities:['collision'],executionMode:'realtime',qualityPolicy:{deterministicRequired:true}}));
    expect(bundle).toMatchObject({schema:'agentscape.world-physics-requirements',worldRevisionId:'rev-p',requirements:[{entityId:'door',bodyClass:'articulated',requiredCapabilities:['articulated-body','joints','collision'],executionMode:'realtime'}]});
    const result=admitWorldPhysics(bundle,{profile:profileOf(backend()),resolvedAssets:[{id:'door',assetRef:{assetId:'cabinet'}}],getManifest:()=>({parts:{door:{joint:{type:'revolute'}}}})});
    expect(result).toMatchObject({status:'ready',backend:{identity:'test',qualities:{deterministic:true,realtime:true}},issues:[]});
  });
  it('fails closed when the authoritative backend lacks a required capability',()=>{
    const bundle=compileWorldPhysicsRequirements(ir({bodyClass:'soft',requiredCapabilities:[],executionMode:'realtime'}));
    expect(admitWorldPhysics(bundle,{profile:profileOf(backend()),resolvedAssets:[{id:'door',assetRef:{assetId:'cloth'}}],getManifest:()=>({})})).toMatchObject({status:'rejected',issues:[{code:'PHYSICS_BACKEND_CAPABILITY_MISSING',entityId:'door',capability:'soft-body'}]});
  });
  it('fails closed when declared quality or articulated evidence is missing',()=>{
    const b=new PhysicsBackend('weak',['articulated-body','joints'],{executionModes:['realtime'],qualities:{realtime:true,deterministic:false}});
    const bundle=compileWorldPhysicsRequirements(ir({bodyClass:'articulated',executionMode:'realtime',qualityPolicy:{deterministicRequired:true}}));
    const result=admitWorldPhysics(bundle,{profile:profileOf(b),resolvedAssets:[{id:'door',assetRef:{assetId:'cabinet'}}],getManifest:()=>({parts:{}})});
    expect(result.issues).toEqual(expect.arrayContaining([expect.objectContaining({code:'PHYSICS_DETERMINISM_QUALITY_UNMET'}),expect.objectContaining({code:'PHYSICS_ASSET_ARTICULATION_MISSING'})]));
  });

  it('admits transform-only worlds on the render backend and rejects solver requirements',()=>{
    const renderBackend=new TransformPhysicsBackend();
    const transformBundle=compileWorldPhysicsRequirements(ir({bodyClass:'transform'}));
    expect(transformBundle.requirements[0]).toMatchObject({
      bodyClass:'transform',requiredCapabilities:['transform-state'],executionMode:'render-only'
    });
    expect(admitWorldPhysics(transformBundle,{
      profile:profileOf(renderBackend),
      resolvedAssets:[{id:'door',assetRef:{assetId:'preview'}}],
      getManifest:()=>({})
    })).toMatchObject({status:'ready',backend:{identity:'transform'},issues:[]});

    const rigidBundle=compileWorldPhysicsRequirements(ir({bodyClass:'rigid',requiredCapabilities:['collision']}));
    const rejected=admitWorldPhysics(rigidBundle,{
      profile:profileOf(renderBackend),
      resolvedAssets:[{id:'door',assetRef:{assetId:'crate'}}],
      getManifest:()=>({})
    });
    expect(rejected.status).toBe('rejected');
    expect(rejected.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({code:'PHYSICS_BACKEND_CAPABILITY_MISSING',capability:'rigid-body'}),
      expect.objectContaining({code:'PHYSICS_BACKEND_CAPABILITY_MISSING',capability:'collision'}),
      expect.objectContaining({code:'PHYSICS_EXECUTION_MODE_UNSUPPORTED',executionMode:'realtime'})
    ]));
  });
  it('admits an empty requirement set even without a backend',()=>{
    expect(admitWorldPhysics(compileWorldPhysicsRequirements({revision:{id:'r'},policy:{physics:{}},entities:[]}),{profile:null})).toMatchObject({status:'ready',issues:[]});
  });
});
