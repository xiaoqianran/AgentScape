import {it,expect} from 'vitest';
import {createSession} from '../../application/createSession.js';
import {createMonumentHall} from '../../modules/world/content/monumentHall.js';
import {createAssetModule} from '../../modules/asset/AssetModule.js';
import {compileRecipeGeometry} from '../../modules/asset/production/AssetRecipe.js';
import {createHeadlessGLTFLoader} from '../../apps/mcp-server/HeadlessGLTFLoader.js';
import {installHeadlessAssetIO} from '../../apps/mcp-server/HeadlessAssetIO.js';

async function importedFixture(type='box') {
  const parts=type==='box' ? [{id:'unknown_solid',position:[0,.2,0],geometry:{type:'box',size:[.4,.4,.4]}}]
    : [{id:'base',position:[-.6,.1,0],geometry:{type:'box',size:[.2,.2,.2]}},
      {id:type==='drawer'?'drawer_mesh':'valve_rotor',position:[0,.8,0],geometry:{type:'box',size:[.4,.2,.4]}}];
  return (await compileRecipeGeometry({schema:'agentscape.asset-recipe',schemaVersion:1,id:`fixture/${type}`,parts})).bytes;
}

const reviewOf=(proposal,type='box')=>({proposalId:proposal.proposalId,confirmed:true,
  physics:{body:type==='box'?'dynamic':'fixed',mass:1,friction:.5},parts:proposal.parts.map(part=>({
    id:part.id,node:part.node,parent:part.parent || '$root',physics:{body:'dynamic',mass:1,friction:.5},
    joint:{type:part.joint.type,axis:type==='drawer'?[0,0,1]:[0,1,0],parentAnchor:[0,.8,0],childAnchor:[0,0,0],limits:[0,type==='drawer'?.3:1]}
  }))});

async function fixture() {
  installHeadlessAssetIO();
  const session=createSession(null,{assetModule:createAssetModule({gltfLoader:createHeadlessGLTFLoader()}),environmentFactory:()=>createMonumentHall({loadAssets:false})});
  await session.world.init();await session.scene.addModel({id:'actor',asset:'builtin://agent'});return session;
}

async function finish(scene,job) {
  for(let n=0;n<1200 && scene.getJob(job.id).status==='running';n++) {scene.step();if(n%12===0)await new Promise(resolve=>setTimeout(resolve,0));else await Promise.resolve();}
  expect(scene.getJob(job.id).status).not.toBe('running');return scene.waitJob(job.id);
}

it.each(['box','drawer','valve'])('imports a new %s GLB through proposal, review, verification and generic execution',async type=>{
  const {scene,world}=await fixture();
  try {
    const bytes=await importedFixture(type),source={kind:'glb',bytes,name:`unseen_${type}.glb`};
    const before=world.assetModule.catalog.list().length;
    const proposal=await scene.prepareAsset(source);
    expect(proposal).toMatchObject({schema:'agentscape.capability-proposal',physics:{mass:null}});
    expect(proposal.operations.every(operation=>!operation.executable && !operation.physicsVerified)).toBe(true);
    expect(world.assetModule.catalog.list()).toHaveLength(before);
    await expect(scene.addModel({id:'unreviewed',asset:source,level:'physical'})).rejects.toMatchObject({code:'CAPABILITY_UNAVAILABLE'});
    const imported=await scene.addModel({id:'imported',asset:{...source,review:reviewOf(proposal,type)},position:[.65,0,0]});
    expect(imported.admission.layers.runtime.status).toBe('ready');
    const action=type==='box'?'push':type==='drawer'?'slide':'rotateJoint';
    const inspection=scene.inspect('imported',{actor:'actor'});
    expect(inspection.actions.find(entry=>entry.action===action),JSON.stringify(inspection)).toMatchObject({available:true});
    const args=type==='box'?{direction:[1,0,0],distance:1}:{part:proposal.parts[0].id,target:type==='drawer'?.25:.8};
    const done=await finish(scene,scene.interact({actor:'actor',target:'imported',action,args}));
    expect(done,JSON.stringify(done)).toMatchObject({status:'succeeded',result:{value:{physicsVerified:true}}});
    if(type==='box') expect(done.result.value.progress).toBeCloseTo(1,1);
    else expect(done.result.value.coordinate).toBeCloseTo(args.target,1);
  } finally {scene.close();world.dispose();}
});

it('reuses the configured URDF provider and existing frame/collider passes without trusting URDF as execution evidence',async()=>{
  const session=await fixture(),{scene,world}=session;
  try {
    let uploaded=null;
    const provider={isConfigured:()=>true,runUrdfProposal:async bytes=>{
      uploaded=bytes;
      return {partProposal:{version:1,source:'urdf/yourdfpy',frameConvention:'urdf-link-local',parts:[{
        id:'drawer',node:'drawer_mesh',parent:'$root',confidence:1,
        joint:{type:'prismatic',axis:[0,0,1],limits:[0,.3],urdf:{parentToJointMatrix:[[1,0,0,0],[0,1,0,.8],[0,0,1,0],[0,0,0,1]]}}
      }]}};
    }};
    world.assetModule.configureProduction({artifacts:session.generation.artifacts,compilerProvider:provider});
    const source={kind:'glb',bytes:await importedFixture('drawer'),urdfBytes:new TextEncoder().encode('<robot name="drawer"/>')};
    const proposal=await scene.prepareAsset(source);
    expect(uploaded).toEqual(source.urdfBytes);
    expect(proposal.parts[0]).toMatchObject({id:'drawer',executable:false,physicsVerified:false,joint:{parentAnchor:[0,.8,0],childAnchor:[0,0,0]}});
    expect(proposal.evidence.jointFrame).toMatchObject({compiled:true,issues:[]});
    const imported=await scene.addModel({id:'urdf_drawer',asset:{...source,review:reviewOf(proposal,'drawer')},position:[.65,0,0]});
    expect(imported.admission.layers.runtime.status).toBe('ready');
    const done=await finish(scene,scene.interact({actor:'actor',target:'urdf_drawer',action:'slide',args:{part:'drawer',distance:.2}}));
    expect(done.status).toBe('succeeded');
  }finally {scene.close();world.dispose();}
});

it.each(['box','drawer'])('keeps a reviewed %s blocked before independent runtime verification',async type=>{
  const {scene,world}=await fixture();
  try {
    const bytes=await importedFixture(type),proposal=await scene.prepareAsset({kind:'glb',bytes});
    await scene.addModel({id:'joint',asset:{kind:'glb',bytes,review:reviewOf(proposal,type)},position:[.65,0,0]});
    const record=world.store.get('joint');delete record.manifest.verification;
    const action=type==='box'?'push':'slide',args=type==='box'?{direction:[1,0,0],distance:1}:{part:proposal.parts[0].id,target:.2};
    expect(scene.inspect('joint',{actor:'actor'}).actions.find(entry=>entry.action===action)).toMatchObject({available:false,reason:'RUNTIME_VERIFICATION_REQUIRED'});
    const failed=await finish(scene,scene.interact({actor:'actor',target:'joint',action,args}));
    expect(failed).toMatchObject({status:'failed',result:{value:{reason:'RUNTIME_VERIFICATION_REQUIRED'}}});
  }finally {scene.close();world.dispose();}
});

it('binds review to source bytes, rejects forged evidence and never registers failed physical candidates',async()=>{
  const {scene,world}=await fixture();
  try {
    const bytes=await importedFixture('drawer'),proposal=await scene.prepareAsset({kind:'glb',bytes});
    const review=reviewOf(proposal,'drawer'),before=world.assetModule.catalog.list().length;
    await expect(scene.addModel({id:'bad',asset:{kind:'glb',bytes:await importedFixture('box'),review}})).rejects.toMatchObject({code:'PROPOSAL_MISMATCH'});
    await expect(scene.addModel({id:'bad',asset:{kind:'glb',bytes,review:{...review,verification:{ok:true}}}})).rejects.toThrow();
    const wrong=structuredClone(review);wrong.parts[0].joint.childAnchor=[2,0,0];
    await expect(scene.addModel({id:'bad',asset:{kind:'glb',bytes,review:wrong}})).rejects.toMatchObject({code:'ASSET_PHYSICS_VERIFICATION_FAILED'});
    expect(world.assetModule.catalog.list()).toHaveLength(before);
    expect(world.store.has('bad')).toBe(false);
  } finally {scene.close();world.dispose();}
});
