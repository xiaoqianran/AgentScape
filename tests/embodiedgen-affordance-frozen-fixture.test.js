import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { EmbodiedGenBundleAdapter } from '../src/adapters/EmbodiedGenBundleAdapter.js';
import { AssetCompiler } from '../src/compiler/AssetCompiler.js';
import { assetAdmission } from '../src/assets/admission.js';

const ROOT='tests/fixtures/embodiedgen-affordance-v1';
const readBytes=async(name)=>new Uint8Array(await readFile(`${ROOT}/${name}`));
const readJson=async(name)=>JSON.parse(await readFile(`${ROOT}/${name}`,'utf8'));
const sha256=(bytes)=>createHash('sha256').update(bytes).digest('hex');

describe('EmbodiedGen affordance frozen bundle v1',()=>{
  it('keeps every frozen artifact bound to the expected hashes and production contract source',async()=>{
    const [bundle,expected,primary,segmentation,rawGrasps,urdf]=await Promise.all([
      readJson('bundle.v1.json'),readJson('expected.json'),readBytes('sample_00.glb'),
      readBytes('agentscape_part_segmentation.v1.json'),readBytes('raw_grasps.franka.v1.json'),readBytes('sample_00.urdf')
    ]);
    const byRole=Object.fromEntries(bundle.artifacts.map((artifact)=>[artifact.role,artifact]));
    expect(expected.contractSource).toBe('modal-build@adf9fcf');
    expect(bundle.lineage).toMatchObject({workflow:'asset.affordance',workflowVersion:'part-evidence-only'});
    expect(sha256(primary)).toBe(expected.primaryGlbSha256);
    expect(sha256(segmentation)).toBe(expected.segmentationSha256);
    expect(sha256(rawGrasps)).toBe(expected.rawGraspsSha256);
    expect(sha256(new TextEncoder().encode(`${JSON.stringify(bundle,null,2)}\n`))).toBe(expected.bundleSha256);
    expect(byRole.primary_glb).toMatchObject({sha256:sha256(primary),bytes:primary.byteLength,mediaType:'model/gltf-binary'});
    expect(byRole.source_urdf).toMatchObject({sha256:sha256(urdf),bytes:urdf.byteLength,mediaType:'application/xml'});
    expect(byRole.part_segmentation).toMatchObject({sha256:sha256(segmentation),bytes:segmentation.byteLength});
    expect(byRole.raw_grasps).toMatchObject({sha256:sha256(rawGrasps),bytes:rawGrasps.byteLength});
  });

  it('materializes four provider parts through the real BundleAdapter → Compiler → Admission path',async()=>{
    const [bundle,expected,primary,segmentation,rawGrasps,urdf]=await Promise.all([
      readJson('bundle.v1.json'),readJson('expected.json'),readBytes('sample_00.glb'),
      readBytes('agentscape_part_segmentation.v1.json'),readBytes('raw_grasps.franka.v1.json'),readBytes('sample_00.urdf')
    ]);
    const prepared=await new EmbodiedGenBundleAdapter().prepare(bundle,{artifactBytes:{
      primary,urdf,segmentation,'raw-grasps':rawGrasps
    }});
    const compiler=new AssetCompiler({store:{put:async()=>{}},version:'embodiedgen-affordance-frozen-v1'});
    const result=await compiler.compile(prepared.compilerInput);
    const admission=assetAdmission(result.manifest);

    expect(prepared.providerEvidence.levels).toEqual({partSegmentation:'provider',partSemantics:'none',grasps:'raw-provider-only',urdf:'verified-bytes-only'});
    expect(prepared.compilerInput.partProposal).toBeNull();
    expect(result.partSegmentation.issues).toEqual([]);
    expect(result.partSegmentation.materialization.status).toBe('materialized');
    expect(result.partSegmentation.coverage).toBe(1);
    expect(result.partSegmentation.faceCount).toBe(expected.faceCount);
    expect(result.partSegmentation.segments).toHaveLength(expected.partCount);
    expect(result.partProposal.parts.map((part)=>part.node).sort()).toEqual([...expected.expectedMaterializedNodes].sort());
    expect(result.quality.status).toBe(expected.expectedQuality);
    expect(result.quality.hard).toEqual([]);
    expect(admission.status).toBe('provisional');
    expect(admission.reasons).toEqual(expected.expectedAdmissionReasons);
    expect(Object.keys(result.manifest.parts||{})).toEqual([]);
    expect(result.manifest.provenance.provider).toBe('embodiedgen');
    expect(result.manifest.provenance.providerEvidence.levels.grasps).toBe('raw-provider-only');
    expect(JSON.stringify(result.manifest.provenance.providerEvidence)).not.toContain('faceLabels');
    expect(JSON.stringify(result.manifest.provenance.providerEvidence)).not.toContain('"pose"');
  });

  it('keeps raw grasp payload raw and finite without promoting it to executable actions',async()=>{
    const [raw,expected]=await Promise.all([readJson('raw_grasps.franka.v1.json'),readJson('expected.json')]);
    expect(raw.evidence_level).toBe('raw');
    expect(raw.grasps).toHaveLength(expected.rawGraspCount);
    for(const grasp of raw.grasps){
      expect(Number.isFinite(grasp.score)).toBe(true);
      expect(grasp.pose).toHaveLength(4);
      expect(grasp.pose.flat().every(Number.isFinite)).toBe(true);
    }
    expect(JSON.stringify(raw)).not.toMatch(/pickup|verified\s*:\s*true/i);
  });
});
