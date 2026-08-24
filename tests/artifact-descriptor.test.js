import { describe, expect, it } from 'vitest';
import {
  ArtifactContractError,
  normalizeArtifactDescriptor,
  normalizeArtifactHash,
  normalizeArtifactLocation,
  requireSafeArtifactId
} from '../src/artifacts/ArtifactDescriptor.js';

const H1=`sha256:${'a'.repeat(64)}`;
const HP=`sha256:${'b'.repeat(64)}`;

const descriptor=(overrides={})=>({
  id:'artifact_01',
  role:'primary-glb',
  type:'asset-bundle',
  schema:{id:'agentscape.artifact',version:'1'},
  displayName:'Generated Chair',
  mime:'model/gltf-binary',
  format:'glb',
  bytes:4096,
  hash:H1,
  producer:{
    jobId:'job_01',
    provider:'modal-3d',
    operation:'modal-3d.asset.image_to_3d.v1',
    stage:'reconstructing',
    attempt:1,
    revision:'provider-rev-1',
    model:{id:'model-a',version:'2',revision:'rev-a',providerPrivate:'dropped'},
    workflow:{id:'workflow-a',version:'1',revision:'rev-w'}
  },
  lineage:{
    parents:[{artifactId:'artifact_input',hash:HP,relation:'input'}]
  },
  createdAt:'2026-08-24T07:00:00.000Z',
  expiresAt:'2026-08-25T07:00:00.000Z',
  warnings:['geometry-provisional'],
  retention:{class:'project',expiresAt:'2026-09-24T07:00:00.000Z'},
  locations:[{
    id:'loc_connector',kind:'connector',scope:'job',state:'available',
    verifiedAt:'2026-08-24T07:01:00.000Z',expiresAt:'2026-08-24T08:01:00.000Z',
    access:{kind:'connector-artifact',artifactId:'artifact_01',connector:{id:'unified-connector',instance:'instance_01'}}
  }],
  ...overrides
});

describe('Artifact descriptor contract',()=>{
  it('normalizes a declared artifact without treating provider metadata as verified integrity',()=>{
    const result=normalizeArtifactDescriptor(descriptor());
    expect(result).toMatchObject({
      id:'artifact_01',role:'primary-glb',type:'asset-bundle',
      mime:'model/gltf-binary',format:'glb',bytes:4096,hash:H1,
      integrity:{state:'declared',verifiedAt:null,method:null,rejection:null},
      retention:{class:'project'},
      producer:{jobId:'job_01',provider:'modal-3d',operation:'modal-3d.asset.image_to_3d.v1'}
    });
    expect(result.producer.model).toEqual({id:'model-a',version:'2',revision:'rev-a'});
    expect(result.lineage.parents).toEqual([{artifactId:'artifact_input',hash:HP,relation:'input'}]);
    expect(result.locations[0]).toEqual({
      id:'loc_connector',kind:'connector',scope:'job',state:'available',
      verifiedAt:'2026-08-24T07:01:00.000Z',expiresAt:'2026-08-24T08:01:00.000Z',
      access:{kind:'connector-artifact',artifactId:'artifact_01',connector:{id:'unified-connector',instance:'instance_01'}}
    });
  });

  it('accepts only canonical lowercase SHA-256 and opaque URL-safe artifact IDs',()=>{
    expect(normalizeArtifactHash(H1)).toBe(H1);
    for (const bad of [
      'sha1:abcd',
      `sha256:${'A'.repeat(64)}`,
      `sha256:${'a'.repeat(63)}`,
      'a'.repeat(64)
    ]) expect(()=>normalizeArtifactHash(bad)).toThrow(ArtifactContractError);

    expect(requireSafeArtifactId('artifact_A-01')).toBe('artifact_A-01');
    for (const bad of ['../artifact','artifact/child','artifact?x=1','artifact:remote','']) {
      expect(()=>requireSafeArtifactId(bad)).toThrow(expect.objectContaining({code:'ARTIFACT_ID_INVALID'}));
    }
  });

  it('rejects negative/unsafe byte declarations and invalid MIME/schema metadata',()=>{
    expect(()=>normalizeArtifactDescriptor(descriptor({bytes:-1})))
      .toThrow(expect.objectContaining({code:'ARTIFACT_BYTES_INVALID'}));
    expect(()=>normalizeArtifactDescriptor(descriptor({bytes:Number.MAX_SAFE_INTEGER+1})))
      .toThrow(expect.objectContaining({code:'ARTIFACT_BYTES_INVALID'}));
    expect(()=>normalizeArtifactDescriptor(descriptor({mime:'not mime'})))
      .toThrow(expect.objectContaining({code:'ARTIFACT_DESCRIPTOR_INVALID'}));
    expect(()=>normalizeArtifactDescriptor(descriptor({schema:{id:'bad schema',version:'1'}})))
      .toThrow(expect.objectContaining({code:'ARTIFACT_DESCRIPTOR_INVALID'}));
  });

  it('does not allow an untrusted descriptor to self-promote integrity',()=>{
    expect(()=>normalizeArtifactDescriptor(descriptor({integrity:{state:'verified'}})))
      .toThrow(expect.objectContaining({code:'ARTIFACT_INTEGRITY_EVIDENCE_REQUIRED'}));
    expect(()=>normalizeArtifactDescriptor(descriptor({integrity:{state:'rejected'}})))
      .toThrow(expect.objectContaining({code:'ARTIFACT_INTEGRITY_EVIDENCE_REQUIRED'}));
  });

  it('rejects secret, raw path and signed URL fields anywhere in an untrusted descriptor',()=>{
    const cases=[
      {providerPrivate:{apiKey:'secret'}},
      {providerPrivate:{signedUrl:'https://signed.example/x?sig=y'}},
      {producer:{...descriptor().producer,remoteFunctionCallId:'remote-private'}},
      {locations:[{...descriptor().locations[0],volumePath:'/modal-volume/a.glb'}]}
    ];
    for (const patch of cases) {
      expect(()=>normalizeArtifactDescriptor(descriptor(patch)))
        .toThrow(expect.objectContaining({code:'ARTIFACT_FORBIDDEN_FIELD'}));
    }
  });

  it('rejects unsafe URL/path-bearing UI strings and warnings',()=>{
    expect(()=>normalizeArtifactDescriptor(descriptor({displayName:'https://signed.example/file'})))
      .toThrow(expect.objectContaining({code:'ARTIFACT_FORBIDDEN_VALUE'}));
    expect(()=>normalizeArtifactDescriptor(descriptor({displayName:'/tmp/private/model.glb'})))
      .toThrow(expect.objectContaining({code:'ARTIFACT_FORBIDDEN_VALUE'}));
    expect(()=>normalizeArtifactDescriptor(descriptor({warnings:['Bearer secret-token']})))
      .toThrow(expect.objectContaining({code:'ARTIFACT_FORBIDDEN_VALUE'}));
  });

  it('normalizes lineage and rejects self-reference, duplicate or unknown relations',()=>{
    expect(()=>normalizeArtifactDescriptor(descriptor({
      lineage:{parents:[{artifactId:'artifact_01',hash:HP,relation:'input'}]}
    }))).toThrow(expect.objectContaining({code:'ARTIFACT_LINEAGE_INVALID'}));

    expect(()=>normalizeArtifactDescriptor(descriptor({
      lineage:{parents:[
        {artifactId:'parent_a',hash:HP,relation:'input'},
        {artifactId:'parent_a',hash:HP,relation:'input'}
      ]}
    }))).toThrow(expect.objectContaining({code:'ARTIFACT_LINEAGE_INVALID'}));

    expect(()=>normalizeArtifactDescriptor(descriptor({
      lineage:{parents:[{artifactId:'parent_a',hash:HP,relation:'copied_from'}]}
    }))).toThrow(expect.objectContaining({code:'ARTIFACT_LINEAGE_INVALID'}));
  });

  it('requires safe access handles for available non-legacy locations',()=>{
    for (const bad of [
      {id:'loc_no_access',kind:'connector',scope:'job',state:'available'},
      {id:'loc_cache_no_access',kind:'local-cache',scope:'application',state:'available'},
      {id:'loc_compiled_no_access',kind:'compiled-store',scope:'application',state:'available'}
    ]) {
      expect(()=>normalizeArtifactLocation(bad,'artifact_01'))
        .toThrow(expect.objectContaining({code:'ARTIFACT_LOCATION_INVALID'}));
    }
    expect(normalizeArtifactLocation({
      id:'loc_expired',kind:'connector',scope:'job',state:'expired',access:null
    },'artifact_01')).toMatchObject({state:'expired',access:null});
  });

  it('rejects retention expiry before the artifact creation time',()=>{
    expect(()=>normalizeArtifactDescriptor(descriptor({
      retention:{class:'session',expiresAt:'2026-08-24T06:59:59.000Z'}
    }))).toThrow(expect.objectContaining({code:'ARTIFACT_DESCRIPTOR_INVALID'}));
  });

  it('accepts browser-safe location handles and rejects URL/path transport details',()=>{
    expect(normalizeArtifactLocation({
      id:'loc_cache',kind:'local-cache',scope:'application',state:'available',
      access:{kind:'cache-key',key:'cache_artifact_01'}
    },'artifact_01')).toMatchObject({
      kind:'local-cache',access:{kind:'cache-key',key:'cache_artifact_01'}
    });

    for (const bad of [
      {...descriptor().locations[0],url:'https://signed.example/x'},
      {...descriptor().locations[0],path:'/tmp/a.glb'},
      {...descriptor().locations[0],access:{kind:'connector-artifact',artifactId:'other_artifact',connector:{id:'unified-connector',instance:'instance_01'}}},
      {...descriptor().locations[0],kind:'connector',access:{kind:'raw-url',artifactId:'artifact_01'}}
    ]) {
      expect(()=>normalizeArtifactLocation(bad,'artifact_01')).toThrow(ArtifactContractError);
    }
  });
});
