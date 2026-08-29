import { describe, expect, it, vi } from 'vitest';
import { GenerationJobCenter } from '../generation/orchestration/GenerationJobCenter.js';

describe('GenerationJobCenter direct capability path',()=>{
  it('executes a direct server capability without Connector jobs',async()=>{
    const generateAsset=vi.fn(async()=>({id:'generated_chair',admission:{status:'accepted'}}));
    const submitGenerationJob=vi.fn();
    const center=Object.create(GenerationJobCenter.prototype);
    Object.assign(center,{
      currentCapability:()=>({provider:'server-adapter',operation:'server.asset.text_to_3d.v1',status:'available',connectionRequired:false,output:{roles:['asset']}}),
      costConfirm:{checked:true},assetId:{value:'generated_chair'},inputs:{value:'{"prompt":"chair"}'},profile:{value:''},
      buttons:{submit:{disabled:false}},world:{authoring:{generateAsset},generation:{connectorStatus:()=>({status:'connection-required'}),submitGenerationJob}},
      compileAssetId:{value:''},directAsset:null,selectedJobId:'old-job',resultDisclosure:{open:false},
      setState:vi.fn(),log:vi.fn(),renderSelected:vi.fn(),renderCapabilityHint:vi.fn()
    });
    await center.submit();
    expect(generateAsset).toHaveBeenCalledWith('chair',expect.objectContaining({assetId:'generated_chair',provider:'server-adapter',operation:'server.asset.text_to_3d.v1'}));
    expect(submitGenerationJob).not.toHaveBeenCalled();
    expect(center.directAsset).toEqual({assetId:'generated_chair',admission:{status:'accepted'},status:'asset-ready'});
    expect(center.selectedJobId).toBeNull();
    expect(center.resultDisclosure.open).toBe(true);
  });
});
