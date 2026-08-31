import { describe, expect, it, vi } from 'vitest';
import { GeneratedPlacementDemoRunner } from '../../studio/demos/generated-placement/GeneratedPlacementDemoRunner.js';

const spec={assetId:'generated_red_ceramic_vase',instanceId:'vase_01',assetPrompt:'red vase',assetLabel:'Red Ceramic Vase',supportId:'table_01',surfaceId:'top'};
const memoryStorage=(seed=null)=>{let value=seed?JSON.stringify(seed):null;return {getItem:()=>value,setItem:(_,next)=>{value=next;},removeItem:()=>{value=null;},value:()=>value};};

describe('GeneratedPlacementDemoRunner',()=>{
  it('resumes existing image/asset jobs without duplicate paid submit, then compiles and places',async()=>{
    const storage=memoryStorage({version:1,assetId:spec.assetId,prompt:spec.assetPrompt,phase:'asset',imageJobId:'job_image',assetJobId:'job_asset'});
    const submitGenerationJob=vi.fn();
    const getGenerationJob=vi.fn(async(id)=>id==='job_image'
      ? {status:'provider-succeeded',jobId:id,artifacts:[{id:'artifact_image',role:'primary-image',mime:'image/png',hash:'sha256:image'}]}
      : {status:'provider-succeeded',jobId:id,artifacts:[{id:'artifact_glb',role:'primary-glb',mime:'model/gltf-binary',hash:'sha256:glb'}]});
    const generateAndCompileAsset=vi.fn(async()=>({status:'asset-provisional'}));
    const spawn=vi.fn(async()=>({id:spec.instanceId}));
    const place=vi.fn(()=>({id:spec.instanceId,targetId:spec.supportId,position:[0,1,0]}));
    const world={
      generation:{
        listGenerationCapabilities:()=>({capabilities:[
          {provider:'modal-2d',operation:'modal-2d.image.text_to_image.v1',category:'image-generation',input:{types:['text'],schema:{required:['prompt'],properties:{prompt:{type:'string'}}}},output:{roles:['primary-image'],required:['primary-image']},profiles:{recommended:{}}},
          {provider:'modal-3d',operation:'modal-3d.asset.image_to_3d.v1',category:'asset-generation',input:{types:['image'],schema:{required:['sourceArtifact'],properties:{sourceArtifact:{type:'object'}}}},output:{roles:['primary-glb'],required:['primary-glb']},profiles:{recommended:{}}}
        ]}),
        submitGenerationJob,getGenerationJob,generateAndCompileAsset
      },
      assetCatalog:{resolveExisting:()=>({status:'missing'})},
      store:{has:()=>false},spawn,
      interactions:{place},
      spatial:{supportStatus:()=>({on:true,subjectId:spec.instanceId,targetId:spec.supportId})}
    };
    const result=await new GeneratedPlacementDemoRunner({world,storage,pollIntervalMs:0}).run(spec);
    expect(submitGenerationJob).not.toHaveBeenCalled();
    expect(generateAndCompileAsset).toHaveBeenCalledWith({jobId:'job_asset',assetId:spec.assetId,label:'Red Ceramic Vase'});
    expect(spawn).toHaveBeenCalledWith(spec.assetId,{id:spec.instanceId});
    expect(place).toHaveBeenCalledWith(spec.instanceId,spec.supportId,{surfaceId:'top',clearance:0.03});
    expect(result).toMatchObject({status:'completed',support:{on:true},generation:{imageJobId:'job_image',assetJobId:'job_asset'}});
    expect(storage.value()).toBeNull();
  });
});
