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
    expect(prepared.providerEvidence.levels).toEqual({partSegmentation:'provider',partSemantics:'none',grasps:'raw-provider-only'});
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
