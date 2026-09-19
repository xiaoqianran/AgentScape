import { describe, expect, it, vi } from 'vitest';
import { StudioBuildController, buildInputs, buildProviderOptions, selectBuildCapability } from '../../apps/studio/build/StudioBuildController.js';
import { BuildSession } from '../../apps/studio/build/BuildSession.js';

const imageCapability={
  provider:'modal-2d',operation:'image.text_to_image',category:'image-generation',status:'available',
  input:{types:['text'],schema:{required:['prompt','seed'],properties:{prompt:{type:'string'},seed:{type:'integer',default:42}}}},
  output:{roles:['primary-image'],required:['primary-image']},profiles:{recommended:{}}
};
const assetCapability={
  provider:'modal-3d',operation:'asset.image_to_3d',category:'asset-generation',status:'available',
  input:{types:['image'],schema:{required:['sourceArtifact','quality'],properties:{sourceArtifact:{type:'object'},quality:{type:'string',enum:['standard']}}}},
  output:{roles:['primary-glb'],required:['primary-glb']},profiles:{recommended:{}}
};

describe('StudioBuildController helpers',()=>{
  it('selects capability by product-level route instead of provider-specific UI fields',()=>{
    const generation={listGenerationCapabilities:()=>({capabilities:[imageCapability,assetCapability]})};
    expect(selectBuildCapability(generation,{category:'image-generation',inputType:'text'})).toBe(imageCapability);
    expect(selectBuildCapability(generation,{category:'asset-generation',inputType:'image'})).toBe(assetCapability);
    expect(buildInputs(imageCapability,{prompt:'chair'})).toEqual({prompt:'chair',seed:42});
  });

  it('treats the Studio 3D route as image-only even when a text-to-3D capability exists',()=>{
    const textAssetCapability={
      provider:'text-3d',operation:'asset.text_to_3d',category:'asset-generation',status:'available',
      input:{types:['text'],schema:{required:['prompt'],properties:{prompt:{type:'string'}}}},output:{roles:['primary-glb']},profiles:{recommended:{}}
    };
    const generation={
      connectorStatus:()=>({status:'paired'}),
      listGenerationCapabilities:()=>({capabilities:[textAssetCapability]}),
      listGenerationProviders:()=>({providers:[{id:'text-3d',displayName:'Text 3D'}]}),
      canGenerateAsset:()=>true,
      canGenerateTextWorld:()=>false
    };
    const controller=new StudioBuildController({generation});
    expect(controller.capabilities()).toMatchObject({asset:false,discovered:{asset:false}});
    expect(controller.providerOptions({mode:'asset',inputType:'image'})).toEqual([]);
  });

  it('projects available provider choices from the capability snapshot without hardcoding model ids',()=>{
    const alternate={...assetCapability,provider:'hermit-3d',operation:'asset.image_to_3d.hermit'};
    const generation={
      listGenerationCapabilities:()=>({capabilities:[imageCapability,assetCapability,alternate]}),
      listGenerationProviders:()=>({providers:[
        {id:'modal-3d',displayName:'Modal 3D'},
        {id:'hermit-3d',displayName:'Hermit 3D'}
      ]}),
      canGenerateAsset:({provider}={})=>['modal-3d','hermit-3d'].includes(provider)
    };
    expect(buildProviderOptions(generation,{mode:'asset',inputType:'image'})).toEqual([
      expect.objectContaining({id:'modal-3d',label:'Modal 3D',recommendedProfile:'recommended'}),
      expect.objectContaining({id:'hermit-3d',label:'Hermit 3D',recommendedProfile:'recommended'})
    ]);
    expect(selectBuildCapability(generation,{category:'asset-generation',inputType:'image',provider:'hermit-3d'})).toBe(alternate);
  });
});

describe('StudioBuildController workflows',()=>{
  it('builds and imports an Image Artifact through the existing generation boundary',async()=>{
    const generation={
      connectorStatus:()=>({status:'paired'}),
      listGenerationCapabilities:()=>({capabilities:[imageCapability,assetCapability]}),
      canGenerateAsset:()=>true,canGenerateTextWorld:()=>true,
      submitGenerationJob:vi.fn(async()=>({status:'generation-pending',jobId:'job_image'})),
      getGenerationJob:vi.fn(async()=>({status:'provider-succeeded',jobId:'job_image',artifacts:[{id:'image_01',role:'primary-image',mime:'image/png'}]})),
      importGenerationResult:vi.fn(async()=>({artifact:{id:'image_01',role:'primary-image',mime:'image/png',hash:'sha256:image'}}))
    };
    const controller=new StudioBuildController({generation,pollIntervalMs:0});
    const result=await controller.generateImage({prompt:'red chair'});
    expect(result).toMatchObject({kind:'image',artifactId:'image_01',jobId:'job_image'});
    expect(generation.submitGenerationJob).toHaveBeenCalledWith(expect.objectContaining({provider:'modal-2d',inputs:{prompt:'red chair',seed:42}}));
    expect(generation.importGenerationResult).toHaveBeenCalledWith('job_image',{artifactId:'image_01'});
  });

  it('publishes a Human-approved local image without invoking cloud Text → Image',async()=>{
    const artifact={id:'image_local_01',role:'primary-image',mime:'image/png',hash:`sha256:${'a'.repeat(64)}`,bytes:12};
    const generation={uploadInputArtifact:vi.fn(async()=>artifact)};
    const controller=new StudioBuildController({generation});
    const bytes=new Uint8Array(12);
    const result=await controller.approveLocalImage({bytes,prompt:'station bench'});
    expect(result).toMatchObject({kind:'image',status:'ready',artifactId:'image_local_01',provider:'local-upload',prompt:'station bench'});
    expect(generation.uploadInputArtifact).toHaveBeenCalledWith(bytes,{mime:'image/png'});
  });

  it('continues from an existing Image Artifact into 3D and compiles the resulting Asset',async()=>{
    const generation={
      connectorStatus:()=>({status:'paired'}),
      listGenerationCapabilities:()=>({capabilities:[imageCapability,assetCapability]}),
      canGenerateAsset:()=>true,canGenerateTextWorld:()=>true,
      submitGenerationJob:vi.fn(async()=>({status:'provider-succeeded',jobId:'job_3d',artifacts:[{id:'glb_01',role:'primary-glb',mime:'model/gltf-binary'}]})),
      generateAndCompileAsset:vi.fn(async()=>({status:'asset-ready',assetId:'chair_01'}))
    };
    const controller=new StudioBuildController({generation,pollIntervalMs:0});
    const result=await controller.generateAssetFromImage({
      imageResult:{jobId:'job_image',prompt:'chair',artifact:{id:'image_01',role:'primary-image',mime:'image/png',hash:'sha256:image'}},
      assetId:'chair_01'
    });
    expect(result).toMatchObject({kind:'asset',assetId:'chair_01',sourceArtifactId:'image_01'});
    expect(generation.submitGenerationJob).toHaveBeenCalledWith(expect.objectContaining({
      provider:'modal-3d',parent:{jobId:'job_image'},inputs:{sourceArtifact:{id:'image_01',role:'primary-image',mime:'image/png',hash:'sha256:image'},quality:'standard'}
    }));
    expect(generation.generateAndCompileAsset).toHaveBeenCalledWith({jobId:'job_3d',assetId:'chair_01',label:'chair'});
  });

  it('uses a Human-uploaded Image Artifact for 3D without inventing a parent generation job',async()=>{
    const generation={
      listGenerationCapabilities:()=>({capabilities:[assetCapability]}),
      submitGenerationJob:vi.fn(async()=>({status:'provider-succeeded',jobId:'job_3d_local',artifacts:[{id:'glb_local',role:'primary-glb',mime:'model/gltf-binary'}]})),
      generateAndCompileAsset:vi.fn(async()=>({status:'asset-ready',assetId:'bench_01'}))
    };
    const controller=new StudioBuildController({generation,pollIntervalMs:0});
    await controller.generateAssetFromImage({
      imageResult:{prompt:'bench',artifact:{id:'image_local',role:'primary-image',mime:'image/png',hash:`sha256:${'b'.repeat(64)}`}},
      assetId:'bench_01'
    });
    expect(generation.submitGenerationJob).toHaveBeenCalledWith(expect.objectContaining({
      parent:null,
      inputs:{sourceArtifact:{id:'image_local',role:'primary-image',mime:'image/png',hash:`sha256:${'b'.repeat(64)}`},quality:'standard'}
    }));
  });

  it('prefers a pinned ground anchor over the view center for generated assets',async()=>{
    const placeAtAnchor=vi.fn(async()=>({status:'placement-committed'}));
    const placeAtCenter=vi.fn(async()=>({status:'placement-committed'}));
    const controller=new StudioBuildController({
      generation:{listGenerationCapabilities:()=>({capabilities:[]})},
      placement:{placeAtAnchor,placeAtCenter}
    });
    await controller.placeAsset('chair_01');
    expect(placeAtAnchor).toHaveBeenCalledWith('chair_01');
    expect(placeAtCenter).not.toHaveBeenCalled();
  });

  it('projects World generation and delegates result actions without owning runtime logic',async()=>{
    const placeAtCenter=vi.fn(async()=>({status:'placed'}));
    const openGeneratedWorld=vi.fn(async()=>({status:'environment-ready'}));
    const generation={
      connectorStatus:()=>({status:'paired'}),
      listGenerationCapabilities:()=>({capabilities:[imageCapability]}),
      canGenerateAsset:()=>true,canGenerateTextWorld:()=>true,
      generateTextWorldArtifacts:vi.fn(async()=>({
        status:'world-artifacts-ready',jobs:{image:'j1',world:'j2'},route:{kind:'text-image-world'},
        artifacts:{'world-manifest':{artifact:{id:'manifest_01'}},'world-mesh':{artifact:{id:'mesh_01'}}}
      }))
    };
    const controller=new StudioBuildController({generation,placement:{placeAtCenter},openGeneratedWorld});
    const result=await controller.generateWorld({prompt:'Japanese garden',provider:'modal-world'});
    expect(result).toMatchObject({kind:'world',manifestArtifactId:'manifest_01',provider:'modal-world',artifacts:{'world-manifest':'manifest_01','world-mesh':'mesh_01'}});
    expect(generation.generateTextWorldArtifacts).toHaveBeenCalledWith({prompt:'Japanese garden',worldProvider:'modal-world'});
    await controller.placeAsset('chair_01');
    await controller.openWorld('manifest_01');
    expect(placeAtCenter).toHaveBeenCalledWith('chair_01');
    expect(openGeneratedWorld).toHaveBeenCalledWith('manifest_01');
  });

  it('syncs connector state through explicit composition callbacks',async()=>{
    const state={status:'generation-ready',paired:true};
    const generation={pairConnector:vi.fn(async()=>state)};
    const listeners=new Map();
    const events={
      on:vi.fn((type,listener)=>{ listeners.set(type,listener); return ()=>listeners.delete(type); })
    };
    const syncGenerationState=vi.fn();
    const controller=new StudioBuildController({generation,events,syncGenerationState});
    const listener=vi.fn();
    const off=controller.onGenerationState(listener);
    listeners.get('generation.state')?.({status:'changed'});
    expect(listener).toHaveBeenCalledWith({status:'changed'});
    expect(await controller.connect()).toEqual(state);
    expect(syncGenerationState).toHaveBeenCalledWith(state);
    off();
    expect(listeners.has('generation.state')).toBe(false);
  });
});

describe('StudioBuildController BuildSession orchestration',()=>{
  it('owns Image build session lifecycle and progress projection',async()=>{
    const generation={
      listGenerationCapabilities:()=>({capabilities:[imageCapability]}),
      submitGenerationJob:vi.fn(async()=>({status:'generation-pending',jobId:'job_image'})),
      getGenerationJob:vi.fn(async()=>({status:'provider-succeeded',jobId:'job_image',stage:'decode',artifacts:[{id:'image_01',role:'primary-image',mime:'image/png'}]})),
      importGenerationResult:vi.fn(async()=>({artifact:{id:'image_01',role:'primary-image',mime:'image/png',hash:'sha256:image'}}))
    };
    const session=new BuildSession({mode:'image'});
    const controller=new StudioBuildController({generation,pollIntervalMs:0});
    const result=await controller.runBuild({session,mode:'image',prompt:'red chair'});
    expect(result).toMatchObject({kind:'image',artifactId:'image_01'});
    expect(session.snapshot()).toMatchObject({status:'success',mode:'image',result:{kind:'image',artifactId:'image_01'}});
    expect(session.snapshot().steps.every((step)=>step.status==='completed')).toBe(true);
  });

  it('owns failure projection instead of requiring the React view to fail the session',async()=>{
    const generation={listGenerationCapabilities:()=>({capabilities:[]})};
    const session=new BuildSession({mode:'asset'});
    const controller=new StudioBuildController({generation,pollIntervalMs:0});
    await expect(controller.runBuild({session,mode:'asset',prompt:'chair',imageResult:null})).rejects.toMatchObject({code:'IMAGE_INPUT_REQUIRED'});
    expect(session.snapshot()).toMatchObject({status:'error',mode:'asset',error:{code:'IMAGE_INPUT_REQUIRED'}});
  });
});

describe('StudioBuildController ImageObject workflow',()=>{
  it('owns local-image approval and Image → 3D resume arguments for one draft',async()=>{
    const controller=new StudioBuildController({generation:{}});
    const input={artifactId:'image_01',artifact:{id:'image_01',role:'primary-image',mime:'image/png',hash:'sha256:image'},prompt:'chair'};
    const result={kind:'asset',assetId:'chair_01'};
    const approve=vi.spyOn(controller,'approveLocalImage').mockResolvedValue(input);
    const generate=vi.spyOn(controller,'generateAssetFromImage').mockResolvedValue(result);
    const onInput=vi.fn(async()=>{});
    const onProgress=vi.fn(async()=>{});
    const draft={id:'draft_01',name:'chair',assetId:'chair_01',imageResult:undefined,jobId:undefined};
    await expect(controller.generateImageObjectDraft({
      draft,
      bytes:new Uint8Array([1,2,3]),
      provider:'modal-3d',
      onInput,
      onProgress
    })).resolves.toEqual({input,result});
    expect(approve).toHaveBeenCalledWith({bytes:new Uint8Array([1,2,3]),prompt:'chair'});
    expect(onInput).toHaveBeenCalledWith(input);
    expect(generate).toHaveBeenCalledWith({
      imageResult:input,
      assetId:'chair_01',
      provider:'modal-3d',
      resumeJobId:null,
      idempotencyKey:'image-object-chair_01',
      onProgress
    });
  });

  it('requires terminal job state before allowing a failed ImageObject draft to rebuild',async()=>{
    const getGenerationJob=vi.fn()
      .mockResolvedValueOnce({jobId:'job_1',status:'generation-pending'})
      .mockResolvedValueOnce({jobId:'job_1',status:'generation-failed'});
    const controller=new StudioBuildController({generation:{getGenerationJob}});
    await expect(controller.assertImageObjectRetryable('job_1')).rejects.toThrow(/尚未确认失败/);
    await expect(controller.assertImageObjectRetryable('job_1')).resolves.toMatchObject({status:'generation-failed'});
  });
});
