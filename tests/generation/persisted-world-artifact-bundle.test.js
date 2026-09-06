import { describe, expect, it } from 'vitest';
import { resolvePersistedWorldArtifactBundle } from '../../generation/orchestration/PromptHybridWorldOrchestrator.js';

const HASH=(value)=>`sha256:${value.repeat(64).slice(0,64)}`;
const roleMeta={
  'world-manifest':['application/json','json'],
  'world-mesh':['model/ply','ply'],
  'world-semantics':['application/json','json'],
  'world-visual':['model/spz','spz'],
  'world-navigation':['model/ply','ply']
};

const artifact=(role,{jobId='job_world',state='verified',suffix='a'}={})=>({
  id:`artifact_${role}_${suffix}`,
  role,
  mime:roleMeta[role][0],
  format:roleMeta[role][1],
  bytes:16,
  hash:HASH(suffix),
  integrity:{state},
  producer:{jobId,provider:'modal-world',operation:'modal-world.world.image_to_world.v1'},
  lineage:{parents:[]},
  locations:[{id:`loc_${role}_${suffix}`,kind:'local-cache',scope:'application',state:'available',access:{kind:'cache-key',key:`cache_${role}_${suffix}`}}]
});

function runtime(entries) {
  const map=new Map(entries.map((item)=>[item.id,item]));
  return {generation:{artifacts:{registry:{get:(id)=>map.get(id)||null,list:()=>[...map.values()]}}}};
}

describe('resolvePersistedWorldArtifactBundle',()=>{
  it('reconstructs exactly one verified World bundle from one producer Job',()=>{
    const entries=['world-manifest','world-mesh','world-semantics','world-visual','world-navigation'].map((role)=>artifact(role));
    entries.push(artifact('world-mesh',{jobId:'job_other',suffix:'b'}));
    const result=resolvePersistedWorldArtifactBundle(runtime(entries),'artifact_world-manifest_a');
    expect(result).toMatchObject({status:'world-artifacts-ready',jobs:{world:'job_world'},route:{kind:'persisted-world-artifacts',world:{provider:'modal-world'}}});
    expect(Object.keys(result.artifacts).sort()).toEqual(['world-manifest','world-mesh','world-navigation','world-semantics','world-visual']);
    expect(result.artifacts['world-mesh']).toMatchObject({cacheKey:'cache_world-mesh_a',artifact:{integrity:'verified',role:'world-mesh'}});
  });

  it('fails closed when a required role is missing',()=>{
    const entries=['world-manifest','world-mesh','world-semantics'].map((role)=>artifact(role));
    expect(()=>resolvePersistedWorldArtifactBundle(runtime(entries),'artifact_world-manifest_a'))
      .toThrow(expect.objectContaining({code:'GENERATED_WORLD_BUNDLE_INCOMPLETE'}));
  });

  it('fails closed when one Job contains ambiguous duplicate roles',()=>{
    const entries=['world-manifest','world-mesh','world-semantics','world-visual'].map((role)=>artifact(role));
    entries.push(artifact('world-mesh',{suffix:'b'}));
    expect(()=>resolvePersistedWorldArtifactBundle(runtime(entries),'artifact_world-manifest_a'))
      .toThrow(expect.objectContaining({code:'GENERATED_WORLD_BUNDLE_AMBIGUOUS'}));
  });

  it('refuses an unverified member even when every role exists',()=>{
    const entries=['world-manifest','world-mesh','world-semantics','world-visual'].map((role)=>artifact(role,role==='world-visual'?{state:'declared'}:{}));
    expect(()=>resolvePersistedWorldArtifactBundle(runtime(entries),'artifact_world-manifest_a'))
      .toThrow(expect.objectContaining({code:'GENERATED_WORLD_ARTIFACT_UNVERIFIED'}));
  });
});
