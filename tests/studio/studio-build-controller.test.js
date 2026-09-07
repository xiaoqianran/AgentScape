import { describe, expect, it, vi } from 'vitest';
import { StudioBuildController, buildInputs, selectBuildCapability } from '../../studio/build/StudioBuildController.js';

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
    const controller=new StudioBuildController({world:{generation},pollIntervalMs:0});
    const result=await controller.generateImage({prompt:'red chair'});
    expect(result).toMatchObject({kind:'image',artifactId:'image_01',jobId:'job_image'});
    expect(generation.submitGenerationJob).toHaveBeenCalledWith(expect.objectContaining({provider:'modal-2d',inputs:{prompt:'red chair',seed:42}}));
    expect(generation.importGenerationResult).toHaveBeenCalledWith('job_image',{artifactId:'image_01'});
  });

  it('continues from an existing Image Artifact into 3D and compiles the resulting Asset',async()=>{
    const generation={
      connectorStatus:()=>({status:'paired'}),
      listGenerationCapabilities:()=>({capabilities:[imageCapability,assetCapability]}),
      canGenerateAsset:()=>true,canGenerateTextWorld:()=>true,
      submitGenerationJob:vi.fn(async()=>({status:'provider-succeeded',jobId:'job_3d',artifacts:[{id:'glb_01',role:'primary-glb',mime:'model/gltf-binary'}]})),
      generateAndCompileAsset:vi.fn(async()=>({status:'asset-ready',assetId:'chair_01'}))
    };
    const controller=new StudioBuildController({world:{generation},pollIntervalMs:0});
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
    const controller=new StudioBuildController({world:{generation},placement:{placeAtCenter},openGeneratedWorld});
    const result=await controller.generateWorld({prompt:'Japanese garden'});
    expect(result).toMatchObject({kind:'world',manifestArtifactId:'manifest_01',artifacts:{'world-manifest':'manifest_01','world-mesh':'mesh_01'}});
    await controller.placeAsset('chair_01');
    await controller.openWorld('manifest_01');
    expect(placeAtCenter).toHaveBeenCalledWith('chair_01');
    expect(openGeneratedWorld).toHaveBeenCalledWith('manifest_01');
  });
});
