import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { EmbodiedGenBundleAdapter } from '../../asset/adapters/EmbodiedGenBundleAdapter.js';
import { AssetCompiler } from '../../asset/compiler/AssetCompiler.js';
import { assetAdmission } from '../../asset/admission.js';

const enc=new TextEncoder();
const sha256=(bytes)=>createHash('sha256').update(bytes).digest('hex');
const descriptor=(id,role,mediaType,bytes)=>({id,role,mediaType,sha256:sha256(bytes),bytes:bytes.byteLength,fileName:`${id}.json`});

const fixture=async()=>{
  const primary=new Uint8Array(await readFile('public/assets/cabinet.glb'));
  const primarySha=sha256(primary);
  const segmentation={version:1,source:'embodiedgen/p3sam',faceCount:12,segments:[{id:'0',faceCount:6},{id:'1',faceCount:6}],artifact:{sha256:primarySha},materialization:{sourceNode:'Door',primitives:[{primitive:0,faceLabels:[...Array(6).fill('0'),...Array(6).fill('1')]}]}};
  const segmentationBytes=enc.encode(JSON.stringify(segmentation));
  const semantics={
    version:1,source:'embodiedgen/gpt-part-semantics',profile:'part-semantics-v1',
    sourceJobId:`job-${'1'.repeat(32)}`,outputJobId:`job-${'2'.repeat(32)}`,
    input:{segmentationSha256:sha256(segmentationBytes),rgbGridSha256:'a'.repeat(64),maskGridSha256:'b'.repeat(64),partAtlasSha256:'c'.repeat(64)},
    provenance:{apiStyle:'openai-compatible',model:'meta/muse-glimmer-30b',promptRevision:'d'.repeat(64),requestIds:['safe-request-id'],attempts:1},
    parts:[
      {id:'0',mask_color:'Red',part_name:'handle',graspable:true,grasp_scenarios:[{scenario:'side grasp',confidence:.9}],functional_labels:['provide grip'],semantic_description:'Visible handle region.'},
      {id:'1',mask_color:'Green',part_name:'body',graspable:false,grasp_scenarios:[],functional_labels:['support object'],semantic_description:'Main rigid body.'},
    ]
  };
  const semanticsBytes=enc.encode(JSON.stringify(semantics));
  const bundle={version:1,provider:'embodiedgen',sourceJobId:semantics.sourceJobId,asset:{id:'semantic_bundle'},lineage:{modalBuildCommit:'eda84b7',workflow:'asset.affordance',workflowVersion:'semantic-evidence-v1'},artifacts:[
    {id:'glb',role:'primary_glb',mediaType:'model/gltf-binary',sha256:primarySha,bytes:primary.byteLength,fileName:'sample_00.glb'},
    descriptor('segments','part_segmentation','application/vnd.agentscape.part-segmentation+json',segmentationBytes),
    descriptor('semantics','part_semantics','application/json',semanticsBytes),
  ]};
  return {primary,segmentationBytes,semantics,semanticsBytes,bundle};
};

describe('EmbodiedGen semantic evidence bridge',()=>{
  it('verifies semantic bytes/schema/segmentation binding and builds semantic-only Part Proposal',async()=>{
    const {primary,segmentationBytes,semanticsBytes,bundle}=await fixture();
    const prepared=await new EmbodiedGenBundleAdapter().prepare(bundle,{artifactBytes:{glb:primary,segments:segmentationBytes,semantics:semanticsBytes}});
    expect(prepared.providerEvidence.levels.partSemantics).toBe('provider-verified');
    expect(prepared.providerEvidence.semantics).toMatchObject({status:'verified',model:'meta/muse-glimmer-30b',partCount:2,mappedToPartProposal:true});
    expect(prepared.compilerInput.partProposal).toEqual({version:1,source:'embodiedgen/gpt-part-semantics',confidence:0,parts:[{id:'0',semantic:'handle',confidence:0},{id:'1',semantic:'body',confidence:0}]});
  });

  it('materializes semantic-only parts but never promotes them to executable articulation',async()=>{
    const {primary,segmentationBytes,semanticsBytes,bundle}=await fixture();
    const prepared=await new EmbodiedGenBundleAdapter().prepare(bundle,{artifactBytes:{glb:primary,segments:segmentationBytes,semantics:semanticsBytes}});
    const result=await new AssetCompiler({store:{put:async()=>{}},version:'semantic-bridge-test'}).compile(prepared.compilerInput);
    expect(result.partSegmentation.materialization.status).toBe('materialized');
    expect(result.partProposal.accepted).toBe(true);
    expect(result.partProposal.promoted).toEqual([]);
    expect(result.partProposal.parts.map((part)=>({id:part.id,node:part.node,semantic:part.semantic}))).toEqual([
      {id:'0',node:'Door__part_0',semantic:'handle'},
      {id:'1',node:'Door__part_1',semantic:'body'},
    ]);
    expect(result.quality.advisory.map((item)=>item.code)).not.toContain('PART_SEMANTICS_UNVERIFIED');
    expect(result.quality.advisory.map((item)=>item.code)).toContain('PART_PROPOSAL_PARTIAL');
    expect(assetAdmission(result.manifest).status).toBe('provisional');
    expect(result.manifest.actions).toEqual(['move']);
    expect(result.manifest.actions).not.toEqual(expect.arrayContaining(['pickup','open','close']));
  });

  it('fails closed on segmentation SHA/part ID mismatch and executable semantic fields',async()=>{
    const {primary,segmentationBytes,semantics,semanticsBytes,bundle}=await fixture();
    const badSha=structuredClone(semantics); badSha.input.segmentationSha256='f'.repeat(64);
    let bytes=enc.encode(JSON.stringify(badSha));
    bundle.artifacts=bundle.artifacts.map((item)=>item.role==='part_semantics'?descriptor('semantics','part_semantics','application/json',bytes):item);
    await expect(new EmbodiedGenBundleAdapter().prepare(bundle,{artifactBytes:{glb:primary,segments:segmentationBytes,semantics:bytes}})).rejects.toMatchObject({code:'EMBODIEDGEN_SEMANTICS_SEGMENTATION_MISMATCH'});

    const {bundle:bundle2}=await fixture(); const badId=structuredClone(semantics); badId.parts[1].id='missing'; bytes=enc.encode(JSON.stringify(badId));
    bundle2.artifacts=bundle2.artifacts.map((item)=>item.role==='part_semantics'?descriptor('semantics','part_semantics','application/json',bytes):item);
    await expect(new EmbodiedGenBundleAdapter().prepare(bundle2,{artifactBytes:{glb:primary,segments:segmentationBytes,semantics:bytes}})).rejects.toMatchObject({code:'EMBODIEDGEN_SEMANTICS_INVALID'});

    const {bundle:bundle3}=await fixture(); const forbidden=structuredClone(semantics); forbidden.parts[0].joint={type:'revolute'}; bytes=enc.encode(JSON.stringify(forbidden));
    bundle3.artifacts=bundle3.artifacts.map((item)=>item.role==='part_semantics'?descriptor('semantics','part_semantics','application/json',bytes):item);
    await expect(new EmbodiedGenBundleAdapter().prepare(bundle3,{artifactBytes:{glb:primary,segments:segmentationBytes,semantics:bytes}})).rejects.toMatchObject({code:'EMBODIEDGEN_SEMANTICS_FORBIDDEN_FIELD'});
    expect(sha256(semanticsBytes)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('keeps verified semantic evidence out of Part Proposal when non-empty URDF proposal wins',async()=>{
    const {primary,segmentationBytes,semanticsBytes,bundle}=await fixture();
    const urdf=enc.encode('<robot name="x"><link name="base"/></robot>');
    bundle.artifacts.push(descriptor('urdf','source_urdf','application/xml',urdf));
    const matrix=[[1,0,0,0],[0,1,0,0],[0,0,1,0],[0,0,0,1]];
    const compilerProvider={isConfigured:()=>true,runUrdfProposal:async()=>({partProposal:{version:1,source:'urdf/yourdfpy',frameConvention:'urdf-link-local',confidence:1,parts:[{id:'hinge',node:'Door',parent:'$root',confidence:1,joint:{type:'revolute',axis:[0,1,0],limits:[-1,0],urdf:{name:'hinge',parentLink:'base',childLink:'Door',originMatrix:matrix,parentToJointMatrix:matrix}}}]}})};
    const prepared=await new EmbodiedGenBundleAdapter({compilerProvider}).prepare(bundle,{artifactBytes:{glb:primary,segments:segmentationBytes,semantics:semanticsBytes,urdf}});
    expect(prepared.compilerInput.partProposal.source).toBe('urdf/yourdfpy');
    expect(prepared.providerEvidence.semantics.mappedToPartProposal).toBe(false);
    expect(prepared.providerEvidence.levels.partSemantics).toBe('provider-verified');
  });
});
