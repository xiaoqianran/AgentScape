import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { EmbodiedGenBundleAdapter } from '../src/adapters/EmbodiedGenBundleAdapter.js';
import { AssetCompiler } from '../src/compiler/AssetCompiler.js';

const enc = new TextEncoder();
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const makeDescriptor = (id, role, mediaType, bytes, extra = {}) => ({ id, role, mediaType, sha256:sha256(bytes), bytes:bytes.byteLength, ...extra });

const fixture = async () => {
  const primary = new Uint8Array(await readFile('public/assets/cabinet.glb'));
  const primarySha = sha256(primary);
  const segmentation = {
    version:1, source:'embodiedgen/p3sam', faceCount:12,
    segments:[{id:'a',faceCount:6},{id:'b',faceCount:6}],
    artifact:{role:'primary_glb',sha256:primarySha},
    materialization:{sourceNode:'Door',primitives:[{primitive:0,faceLabels:[...Array(6).fill('a'),...Array(6).fill('b')]}]}
  };
  const segmentationBytes = enc.encode(JSON.stringify(segmentation));
  const rawGrasps = enc.encode(JSON.stringify({version:1,evidence_level:'raw',grasps:[{score:.8,pose:[1]}]}));
  const bundle = {
    version:1, provider:'embodiedgen', sourceJobId:`job-${'a'.repeat(32)}`,
    asset:{id:'bundle_cabinet',label:'Provider cabinet'},
    lineage:{providerCommit:'deadbeef',seed:42,authorization:'Bearer SECRET',signedUrl:'https://secret.test/x?sig=SECRET'},
    artifacts:[
      makeDescriptor('glb','primary_glb','model/gltf-binary',primary,{fileName:'sample_00.glb'}),
      makeDescriptor('segments','part_segmentation','application/vnd.agentscape.part-segmentation+json',segmentationBytes),
      makeDescriptor('grasps','raw_grasps','application/json',rawGrasps)
    ]
  };
  return { primary, segmentation, segmentationBytes, rawGrasps, bundle };
};

describe('EmbodiedGenBundleAdapter', () => {
  it('verifies primary + segmentation bytes and prepares existing AssetCompiler input', async () => {
    const { primary, segmentationBytes, rawGrasps, bundle } = await fixture();
    const prepared = await new EmbodiedGenBundleAdapter().prepare(bundle,{artifactBytes:{glb:primary,segments:segmentationBytes,grasps:rawGrasps}});
    expect(prepared.compilerInput.assetId).toBe('bundle_cabinet');
    expect(prepared.compilerInput.sourceName).toBe('sample_00.glb');
    expect(prepared.compilerInput.partSegmentation.source).toBe('embodiedgen/p3sam');
    expect(prepared.compilerInput.partProposal).toBeNull();
    expect(prepared.providerEvidence.levels).toEqual({partSegmentation:'provider',partSemantics:'none',grasps:'raw-provider-only',urdf:'none'});
    expect(prepared.providerEvidence.artifacts.find((item)=>item.role==='raw_grasps').verified).toBe(false);
    expect(prepared.providerEvidence.lineage).toEqual({providerCommit:'deadbeef',seed:42});
    expect(JSON.stringify(prepared.providerEvidence)).not.toContain('SECRET');
  });

  it('fails closed on primary artifact hash mismatch', async () => {
    const { primary, segmentationBytes, bundle } = await fixture();
    const corrupted=primary.slice(); corrupted[10]^=1;
    await expect(new EmbodiedGenBundleAdapter().prepare(bundle,{artifactBytes:{glb:corrupted,segments:segmentationBytes}})).rejects.toMatchObject({code:'EMBODIEDGEN_ARTIFACT_HASH_MISMATCH'});
  });

  it('fails closed when segmentation points at a different GLB hash', async () => {
    const { primary, segmentation, bundle } = await fixture();
    segmentation.artifact.sha256='0'.repeat(64);
    const bytes=enc.encode(JSON.stringify(segmentation));
    bundle.artifacts=bundle.artifacts.map((item)=>item.role==='part_segmentation'?makeDescriptor('segments','part_segmentation','application/json',bytes):item);
    await expect(new EmbodiedGenBundleAdapter().prepare(bundle,{artifactBytes:{glb:primary,segments:bytes}})).rejects.toMatchObject({code:'EMBODIEDGEN_SEGMENTATION_GLB_MISMATCH'});
  });

  it('does not promote raw grasp evidence into a Part Proposal or runtime action', async () => {
    const { primary, segmentationBytes, rawGrasps, bundle } = await fixture();
    const prepared=await new EmbodiedGenBundleAdapter().prepare(bundle,{artifactBytes:{glb:primary,segments:segmentationBytes,grasps:rawGrasps}});
    expect(prepared.compilerInput.partProposal).toBeNull();
    expect(prepared.providerEvidence.levels.grasps).toBe('raw-provider-only');
    expect(JSON.stringify(prepared.compilerInput)).not.toMatch(/pickup|open|close/);
  });

  it('materializes a bundle through the existing AssetCompiler and remains provisional', async () => {
    const { primary, segmentationBytes, bundle } = await fixture();
    const { compilerInput }=await new EmbodiedGenBundleAdapter().prepare(bundle,{artifactBytes:{glb:primary,segments:segmentationBytes}});
    const store={put:async()=>{}};
    const result=await new AssetCompiler({store,version:'bundle-test'}).compile(compilerInput);
    expect(result.partSegmentation.materialization.status).toBe('materialized');
    expect(result.partSegmentation.issues).toEqual([]);
    expect(result.partSegmentation.coverage).toBe(1);
    expect(result.partProposal.parts.map((part)=>part.node).sort()).toEqual(['Door__part_a','Door__part_b']);
    expect(result.quality.status).toBe('provisional');
    expect(result.quality.advisory.map((item)=>item.code)).toEqual(expect.arrayContaining(['PART_SEMANTICS_UNVERIFIED','PROVIDER_GRASP_RAW_ONLY']));
    expect(Object.keys(result.manifest.parts||{})).toEqual([]);
    expect(result.manifest.provenance.provider).toBe('embodiedgen');
    expect(result.manifest.provenance.providerEvidence.levels.grasps).toBe('raw-provider-only');
    expect(JSON.stringify(result.manifest.provenance.providerEvidence)).not.toContain('faceLabels');
  });



  it('verifies source URDF bytes and keeps them evidence-only when no parser is configured', async () => {
    const { primary, segmentationBytes, bundle }=await fixture();
    const urdf=enc.encode('<robot name="cabinet"><link name="base"/></robot>');
    bundle.artifacts.push(makeDescriptor('urdf','source_urdf','application/xml',urdf));
    const prepared=await new EmbodiedGenBundleAdapter().prepare(bundle,{artifactBytes:{glb:primary,segments:segmentationBytes,urdf}});
    expect(prepared.compilerInput.partProposal).toBeNull();
    expect(prepared.providerEvidence.levels.urdf).toBe('verified-bytes-only');
    expect(prepared.providerEvidence.urdf).toMatchObject({
      artifactId:'urdf',sha256:sha256(urdf),status:'verified-bytes-only',parser:null,partCount:null,frameConvention:null
    });
    expect(prepared.providerEvidence.artifacts.find((item)=>item.role==='source_urdf').verified).toBe(true);
  });

  it('rejects source URDF bytes above the bounded browser-side limit before parser invocation', async () => {
    const { primary, segmentationBytes, bundle }=await fixture();
    const urdf=new Uint8Array(5*1024*1024+1);
    bundle.artifacts.push(makeDescriptor('urdf','source_urdf','application/xml',urdf));
    const parser={isConfigured:()=>true,runUrdfProposal:async()=>{throw new Error('must not run');}};
    await expect(new EmbodiedGenBundleAdapter({compilerProvider:parser}).prepare(bundle,{artifactBytes:{glb:primary,segments:segmentationBytes,urdf}}))
      .rejects.toMatchObject({code:'EMBODIEDGEN_URDF_TOO_LARGE'});
  });

  it('fails closed on source URDF hash mismatch or unsupported media type', async () => {
    const { primary, segmentationBytes, bundle }=await fixture();
    const urdf=enc.encode('<robot name="cabinet"><link name="base"/></robot>');
    bundle.artifacts.push(makeDescriptor('urdf','source_urdf','application/xml',urdf));
    const corrupted=urdf.slice(); corrupted[3]^=1;
    await expect(new EmbodiedGenBundleAdapter().prepare(bundle,{artifactBytes:{glb:primary,segments:segmentationBytes,urdf:corrupted}}))
      .rejects.toMatchObject({code:'EMBODIEDGEN_ARTIFACT_HASH_MISMATCH'});
    bundle.artifacts=bundle.artifacts.map((item)=>item.role==='source_urdf'?{...item,mediaType:'text/html'}:item);
    await expect(new EmbodiedGenBundleAdapter().prepare(bundle,{artifactBytes:{glb:primary,segments:segmentationBytes,urdf}}))
      .rejects.toMatchObject({code:'EMBODIEDGEN_URDF_MEDIA_TYPE_INVALID'});
  });

  it('accepts bounded yourdfpy mechanical evidence but does not promote executable actions/physics', async () => {
    const { primary, segmentationBytes, bundle }=await fixture();
    const urdf=enc.encode('<robot name="cabinet"><link name="base"/><link name="Door"/></robot>');
    bundle.artifacts.push(makeDescriptor('urdf','source_urdf','application/xml',urdf));
    const matrix=[
      [1,0,0,0.25],[0,1,0,0.5],[0,0,1,0],[0,0,0,1]
    ];
    const compilerProvider={
      isConfigured:()=>true,
      runUrdfProposal:async()=>({partProposal:{
        version:1,source:'urdf/yourdfpy',frameConvention:'urdf-link-local',confidence:1,
        parts:[{
          id:'door_joint',node:'Door',parent:'$root',confidence:1,
          joint:{type:'revolute',axis:[0,1,0],limits:[-1,0],urdf:{
            name:'door_hinge',parentLink:'base',childLink:'Door',originMatrix:matrix,parentToJointMatrix:matrix
          }}
        }]
      }})
    };
    const prepared=await new EmbodiedGenBundleAdapter({compilerProvider}).prepare(bundle,{artifactBytes:{glb:primary,segments:segmentationBytes,urdf}});
    expect(prepared.providerEvidence.levels.urdf).toBe('service-parsed');
    expect(prepared.providerEvidence.urdf).toMatchObject({parser:'asset-compiler/yourdfpy',partCount:1,frameConvention:'urdf-link-local'});
    expect(prepared.compilerInput.partProposal).toMatchObject({
      source:'urdf/yourdfpy',frameConvention:'urdf-link-local',parts:[{id:'door_joint',node:'Door',joint:{type:'revolute',axis:[0,1,0],limits:[-1,0]}}]
    });
    expect(JSON.stringify(prepared.compilerInput.partProposal)).not.toMatch(/actions|physics|pickup|open|close/);
  });

  it('rejects executable/transport fields from URDF parser response before compiler input', async () => {
    const { primary, segmentationBytes, bundle }=await fixture();
    const urdf=enc.encode('<robot name="cabinet"><link name="base"/></robot>');
    bundle.artifacts.push(makeDescriptor('urdf','source_urdf','application/xml',urdf));
    const compilerProvider={
      isConfigured:()=>true,
      runUrdfProposal:async()=>({partProposal:{
        version:1,source:'urdf/yourdfpy',frameConvention:'urdf-link-local',confidence:1,
        parts:[],actions:['open'],signedUrl:'https://evil.test/x?token=secret'
      }})
    };
    const prepared=await new EmbodiedGenBundleAdapter({compilerProvider}).prepare(bundle,{artifactBytes:{glb:primary,segments:segmentationBytes,urdf}});
    expect(prepared.compilerInput.partProposal).toBeNull();
    expect(prepared.providerEvidence.levels.urdf).toBe('parse-rejected');
    expect(prepared.providerEvidence.urdf).toMatchObject({status:'parse-rejected',errorCode:'EMBODIEDGEN_URDF_PROPOSAL_FORBIDDEN_FIELD'});
    expect(JSON.stringify(prepared.providerEvidence)).not.toContain('evil.test');
    expect(JSON.stringify(prepared.providerEvidence)).not.toContain('actions');
  });

  it('rejects malformed URDF proposal hierarchy before it reaches compiler passes', async () => {
    const { primary, segmentationBytes, bundle }=await fixture();
    const urdf=enc.encode('<robot name="cabinet"><link name="base"/></robot>');
    bundle.artifacts.push(makeDescriptor('urdf','source_urdf','application/xml',urdf));
    const matrix=[[1,0,0,0],[0,1,0,0],[0,0,1,0],[0,0,0,1]];
    const part=(id,node,parent)=>({id,node,parent,confidence:1,joint:{type:'revolute',axis:[0,1,0],limits:[-1,0],urdf:{name:`${id}_joint`,parentLink:'base',childLink:node,originMatrix:matrix,parentToJointMatrix:matrix}}});
    const cases=[
      [part('door','Door','missing')],
      [part('door','Door','drawer'),part('drawer','Drawer','door')],
      [part('door','Door','$root'),part('drawer','Door','$root')]
    ];
    for (const parts of cases) {
      const provider={isConfigured:()=>true,runUrdfProposal:async()=>({partProposal:{version:1,source:'urdf/yourdfpy',frameConvention:'urdf-link-local',confidence:1,parts}})};
      const prepared=await new EmbodiedGenBundleAdapter({compilerProvider:provider}).prepare(bundle,{artifactBytes:{glb:primary,segments:segmentationBytes,urdf}});
      expect(prepared.compilerInput.partProposal).toBeNull();
      expect(prepared.providerEvidence.levels.urdf).toBe('parse-rejected');
      expect(prepared.providerEvidence.urdf.errorCode).toBe('EMBODIEDGEN_URDF_PROPOSAL_INVALID');
    }
  });

  it('keeps valid URDF JointFrame evidence inside the existing compiler and remains provisional', async () => {
    const { primary, segmentationBytes, bundle }=await fixture();
    const urdf=enc.encode('<robot name="cabinet"><link name="base"/><link name="Door"/></robot>');
    bundle.artifacts.push(makeDescriptor('urdf','source_urdf','application/xml',urdf));
    const matrix=[[1,0,0,0.25],[0,1,0,0.5],[0,0,1,0],[0,0,0,1]];
    const compilerProvider={isConfigured:()=>true,runUrdfProposal:async()=>({partProposal:{
      version:1,source:'urdf/yourdfpy',frameConvention:'urdf-link-local',confidence:1,
      parts:[{id:'door_joint',node:'Door',parent:'$root',confidence:1,joint:{
        type:'revolute',axis:[0,1,0],limits:[-1,0],urdf:{name:'door_hinge',parentLink:'base',childLink:'Door',originMatrix:matrix,parentToJointMatrix:matrix}
      }}]
    }})};
    const {compilerInput}=await new EmbodiedGenBundleAdapter({compilerProvider}).prepare(bundle,{artifactBytes:{glb:primary,segments:segmentationBytes,urdf}});
    const result=await new AssetCompiler({store:{put:async()=>{}},version:'urdf-evidence-test'}).compile(compilerInput);
    const part=result.partProposal.parts.find((item)=>item.id==='door_joint');
    expect(part.joint.urdf.parentToJointMatrix).toEqual(matrix);
    expect(result.partProposal.jointFrame.compiled).toBe(true);
    expect(result.partProposal.jointFrame.issues).toContainEqual({part:'door_joint',code:'JOINT_FRAME_SCALE_UNSUPPORTED'});
    expect(part.joint.parentAnchor).toBeUndefined();
    expect(result.quality.status).toBe('provisional');
    expect(JSON.stringify(result.manifest.actions)).not.toMatch(/open|close/);
  });

  it('rejects signed URLs or query-bearing artifact references from durable provenance', async () => {
    const { primary, bundle }=await fixture();
    bundle.artifacts[0]={...bundle.artifacts[0],path:'https://signed.test/a.glb?token=SECRET'};
    await expect(new EmbodiedGenBundleAdapter().prepare(bundle,{artifactBytes:{glb:primary}})).rejects.toMatchObject({code:'EMBODIEDGEN_ARTIFACT_REFERENCE_INVALID'});
    bundle.artifacts[0]={...bundle.artifacts[0],path:'../escape/sample_00.glb'};
    await expect(new EmbodiedGenBundleAdapter().prepare(bundle,{artifactBytes:{glb:primary}})).rejects.toMatchObject({code:'EMBODIEDGEN_ARTIFACT_REFERENCE_INVALID'});
  });

  it('rejects duplicate artifact roles and unsupported bundle versions', async () => {
    const { primary, bundle }=await fixture();
    bundle.artifacts=[bundle.artifacts[0],{...bundle.artifacts[0],id:'glb2'}];
    await expect(new EmbodiedGenBundleAdapter().prepare(bundle,{artifactBytes:{glb:primary,glb2:primary}})).rejects.toMatchObject({code:'EMBODIEDGEN_ARTIFACT_ROLE_DUPLICATE'});
    bundle.version=2;
    await expect(new EmbodiedGenBundleAdapter().prepare(bundle,{artifactBytes:{}})).rejects.toMatchObject({code:'EMBODIEDGEN_BUNDLE_INVALID'});
  });
});
