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
});
