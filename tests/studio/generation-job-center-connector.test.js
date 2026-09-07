import { describe, expect, it, vi } from 'vitest';
import { GenerationJobCenter } from '../../studio/ui/generation/GenerationJobCenter.js';

describe('GenerationJobCenter Connector capability path',()=>{
  it('refuses submission until Connector pairing exists',async()=>{
    const submitGenerationJob=vi.fn();
    const center=Object.create(GenerationJobCenter.prototype);
    Object.assign(center,{
      currentCapability:()=>({provider:'snapshot-provider',operation:'snapshot-provider.asset.text_to_3d.v1',status:'available',connectionRequired:true,output:{roles:['asset']}}),
      costConfirm:{checked:true},assetId:{value:'generated_chair'},inputs:{value:'{"prompt":"chair"}'},profile:{value:''},
      buttons:{submit:{disabled:false}},world:{generation:{connectorStatus:()=>({status:'connection-required'}),submitGenerationJob}},
      compileAssetId:{value:''},selectedJobId:null,resultDisclosure:{open:false},jobsDisclosure:{open:false},assetIds:new Map(),
      setState:vi.fn(),log:vi.fn(),renderCapabilityHint:vi.fn(),refresh:vi.fn()
    });
    await center.submit();
    expect(submitGenerationJob).not.toHaveBeenCalled();
    expect(center.setState).toHaveBeenCalledWith('error','提交失败',expect.stringMatching(/Connector|配对/));
  });

  it('submits only through the normalized Connector Job boundary',async()=>{
    const submitGenerationJob=vi.fn(async()=>({jobId:'job_01',status:'generation-pending',reused:false}));
    const center=Object.create(GenerationJobCenter.prototype);
    Object.assign(center,{
      currentCapability:()=>({provider:'snapshot-provider',operation:'snapshot-provider.asset.text_to_3d.v1',status:'available',connectionRequired:true,output:{roles:['asset']}}),
      costConfirm:{checked:true},assetId:{value:'generated_chair'},inputs:{value:'{"prompt":"chair"}'},profile:{value:'recommended'},
      buttons:{submit:{disabled:false}},world:{generation:{connectorStatus:()=>({status:'paired'}),submitGenerationJob}},
      compileAssetId:{value:''},selectedJobId:null,resultDisclosure:{open:false},jobsDisclosure:{open:false},assetIds:new Map(),
      setState:vi.fn(),log:vi.fn(),renderCapabilityHint:vi.fn(),refresh:vi.fn(async()=>{})
    });
    await center.submit();
    expect(submitGenerationJob).toHaveBeenCalledWith({
      provider:'snapshot-provider',operation:'snapshot-provider.asset.text_to_3d.v1',inputs:{prompt:'chair'},profile:'recommended',outputRoles:['asset']
    });
    expect(center.assetIds.get('job_01')).toBe('generated_chair');
    expect(center.selectedJobId).toBe('job_01');
    expect(center.resultDisclosure.open).toBe(true);
  });

  it('bulk-imports recovered multi-artifact World jobs instead of dropping the bundle',async()=>{
    const importGenerationArtifacts=vi.fn(async()=>({
      status:'artifacts-imported',jobId:'job_world',artifacts:[
        {artifact:{id:'artifact_mesh',role:'world-mesh',integrity:'verified'}},
        {artifact:{id:'artifact_manifest',role:'world-manifest',integrity:'verified'}}
      ]
    }));
    const center=Object.create(GenerationJobCenter.prototype);
    Object.assign(center,{
      selectedJob:()=>({jobId:'job_world',artifacts:[{id:'artifact_mesh'},{id:'artifact_manifest'}]}),
      world:{generation:{importGenerationArtifacts,importGenerationResult:vi.fn()}},
      imports:new Map(),renderSelected:vi.fn(),log:vi.fn()
    });
    await center.importSelected();
    expect(importGenerationArtifacts).toHaveBeenCalledWith('job_world');
    expect(center.imports.get('job_world')).toMatchObject({artifact:{id:'artifact_manifest',role:'world-manifest'}});
    expect(center.log).toHaveBeenCalledWith('产物已导入：2 个 · job_world','result');
  });
});
