import { readFile } from 'node:fs/promises';
import { Document, WebIO } from '@gltf-transform/core';
import { Quaternion, Vector3 } from 'three';
import { expect, it } from 'vitest';
import { createSession } from '../../application/createSession.js';
import { createAssetModule } from '../../modules/asset/AssetModule.js';
import { createHeadlessGLTFLoader } from '../../apps/mcp-server/HeadlessGLTFLoader.js';
import { createMonumentHall } from '../../modules/world/content/monumentHall.js';
import { compileRecipeGeometry } from '../../modules/asset/production/AssetRecipe.js';

async function fixture() {
  const bytes = new Uint8Array(await readFile('public/assets/cabinet.glb'));
  const session = createSession(null,{
    assetModule:createAssetModule({gltfLoader:createHeadlessGLTFLoader()}),
    environmentFactory:()=>createMonumentHall({loadAssets:false})
  });
  await session.world.init();
  return { ...session, bytes };
}

it('prepares source-bound axis hypotheses without granting a runtime capability', async () => {
  const {scene,world,bytes} = await fixture();
  try {
    const before=world.assetModule.catalog.list().length;
    const anonymous=await new WebIO().readBinary(bytes);
    anonymous.getRoot().listNodes().forEach((node,index)=>node.setName(`Node_${index}`));
    const renamedBytes=new Uint8Array(await new WebIO().writeBinary(anonymous));
    const proposal=await scene.prepareAsset({kind:'glb',bytes:renamedBytes,name:'anonymous.glb'});
    expect(proposal.kinematics).toMatchObject({schema:'agentscape.kinematic-evidence',schemaVersion:1});
    expect(proposal.kinematics.hypotheses).toHaveLength(2);
    expect(proposal.kinematics.hypotheses.every(item=>item.status==='candidate'
      && item.executable === false && item.physicsVerified === false && item.functionVerified === false)).toBe(true);
    expect(proposal.kinematics.hypotheses.map(item=>item.pivotWorld[0])).toEqual([-.82,.8]);
    expect(world.assetModule.catalog.list()).toHaveLength(before);
    expect(world.store.size).toBe(0);
    await expect(scene.addModel({id:'unreviewed',asset:{kind:'glb',bytes:renamedBytes},level:'physical'}))
      .rejects.toMatchObject({code:'CAPABILITY_UNAVAILABLE'});
  } finally {scene.close();world.dispose();}
},60000);

it('screens multiple ambiguous panel pivots in isolated Rapier without admitting actions', async () => {
  const {scene,world,bytes}=await fixture();
  try {
    const source={kind:'glb',bytes,name:'cabinet-screen.glb'};
    const proposal=await scene.prepareAsset(source);
    const ids=proposal.kinematics.hypotheses.map(item=>item.id);
    const before=world.assetModule.catalog.list().length;
    const screened=await scene.screenAsset({...source,proposalId:proposal.proposalId,hypothesisIds:ids});
    expect(screened).toMatchObject({schema:'agentscape.kinematic-screen',proposalId:proposal.proposalId,admission:'not-granted'});
    expect(screened.results).toHaveLength(2);
    expect(screened.results.map(item=>item.id)).toEqual(ids);
    expect(screened.results.every(item=>item.physicsVerified===false && item.functionVerified===false
      && item.admission==='not-granted')).toBe(true);
    expect(screened.results.every(item=>item.trials.length===2)).toBe(true);
    expect(screened.results[0].trials.map(item=>item.target)).toEqual([-.5,.5]);
    expect(screened.results[0].trials[0].status).toBe('simulation-passed');
    expect(screened.results[1].trials[0].status).toBe('simulation-failed');
    expect(screened.results.every(item=>item.mechanicalFeasible)).toBe(true);
    expect(screened.results[0].trials[1].status).toBe('simulation-failed');
    expect(screened.results[0].trials[1].evidence.actions[0].failures).toEqual([
      expect.objectContaining({code:'COLLISION_REGRESSION'})
    ]);
    expect(screened.results[1].trials[1].status).toBe('simulation-passed');
    expect(world.assetModule.catalog.list()).toHaveLength(before);
    expect(world.store.size).toBe(0);
  } finally {scene.close();world.dispose();}
},120000);

it('rejects forged selections and stale proposals before running physics', async () => {
  const {scene,world,bytes}=await fixture();
  try {
    const source={kind:'glb',bytes,name:'cabinet-replay.glb'};
    const proposal=await scene.prepareAsset(source);
    const notARealId='kh_999999';
    await expect(scene.screenAsset({...source,proposalId:proposal.proposalId,hypothesisIds:[notARealId]}))
      .rejects.toMatchObject({code:'HYPOTHESIS_NOT_FOUND'});
    // Identity is bound to content and evidence, not cosmetic filename changes.
    const altered=await new WebIO().readBinary(bytes);
    altered.getRoot().listNodes().find(node=>node.getName()==='Door').setName('UnrelatedPart');
    const changedBytes=new Uint8Array(await new WebIO().writeBinary(altered));
    await expect(scene.screenAsset({...source,bytes:changedBytes,proposalId:proposal.proposalId}))
      .rejects.toMatchObject({code:'PROPOSAL_MISMATCH'});
    await expect(scene.screenAsset({...source,proposalId:proposal.proposalId,
      hypothesisIds:[proposal.kinematics.hypotheses[0].id,proposal.kinematics.hypotheses[0].id]}))
      .rejects.toMatchObject({code:'HYPOTHESIS_SELECTION_INVALID'});
    expect(world.store.size).toBe(0);
  }finally {scene.close();world.dispose();}
},70000);

it('screens an observed animated joint without relying on node semantics', async () => {
  const {scene,world}=await fixture();
  try {
    const doc=new Document();
    const buffer=doc.createBuffer();
    const sc=doc.createScene('Scene');
    doc.getRoot().setDefaultScene(sc);
    const makeMesh=(label,x)=>{
      const positions=doc.createAccessor().setType('VEC3').setArray(new Float32Array([
        x,0,0, x+.2,0,0, x,.5,0
      ])).setBuffer(buffer);
      const indices=doc.createAccessor().setType('SCALAR')
        .setArray(new Uint16Array([0,1,2])).setBuffer(buffer);
      return doc.createNode(label).setMesh(doc.createMesh(label+'Mesh').addPrimitive(
        doc.createPrimitive().setAttribute('POSITION',positions).setIndices(indices)));
    };
    sc.addChild(makeMesh('Base_100',-1));
    const movable=makeMesh('Part_200',.5);
    movable.setTranslation([0,0,1]);
    sc.addChild(movable);
    const input=doc.createAccessor().setType('SCALAR').setArray(new Float32Array([0,1,2])).setBuffer(buffer);
    const q=angle=>new Quaternion().setFromAxisAngle(new Vector3(0,1,0),angle).toArray();
    const output=doc.createAccessor().setType('VEC4')
      .setArray(new Float32Array([...q(0),...q(.3),...q(.6)])).setBuffer(buffer);
    const anim=doc.createAnimation('Cycle_9');
    const sampler=doc.createAnimationSampler().setInput(input).setOutput(output).setInterpolation('LINEAR');
    anim.addSampler(sampler).addChannel(doc.createAnimationChannel()
      .setTargetNode(movable).setTargetPath('rotation').setSampler(sampler));
    const source={kind:'glb',bytes:new Uint8Array(await new WebIO().writeBinary(doc)),name:'anonymous.glb'};
    const proposal=await scene.prepareAsset(source);
    const candidates=proposal.kinematics.hypotheses.filter(h=>h.source==='gltf-animation');
    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({jointType:'revolute',limits:[0,.6],
      executable:false,physicsVerified:false});
    const screen=await scene.screenAsset({...source,proposalId:proposal.proposalId,hypothesisIds:[candidates[0].id]});
    expect(screen.results).toHaveLength(1);
    expect(screen.results[0].status).not.toBe('blocked');
    expect(screen.results[0].assumptions.jointLimits).toBe('observed-animation');
    expect(screen.results[0].functionVerified).toBe(false);
    expect(world.store.size).toBe(0);
  }finally{scene.close();world.dispose();}
},90000);

it('returns an empty non-granting screen for a non-articulated single-mesh GLB', async () => {
  const {scene,world}=await fixture();
  try {
    const built=await compileRecipeGeometry({
      schema:'agentscape.asset-recipe',schemaVersion:1,id:'prototype/test',
      parts:[{id:'unknown',geometry:{type:'box',size:[.2,.2,.2]}}]
    });
    const source={kind:'glb',bytes:built.bytes,name:'opaque.glb'};
    const prepared=await scene.prepareAsset(source);
    expect(prepared.kinematics.hypotheses).toEqual([]);
    const screen=await scene.screenAsset({...source,proposalId:prepared.proposalId});
    expect(screen).toMatchObject({results:[],admission:'not-granted'});
    expect(world.store.size).toBe(0);
  } finally {scene.close();world.dispose();}
},60000);
