import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { describe, expect, it, vi } from "vitest";
import { AssetCompiler } from "../asset/compiler/AssetCompiler.js";
import { GenerationOrchestrator } from "../generation/orchestration/GenerationOrchestrator.js";
import { createDefaultProviderRegistry } from "../generation/providers/ProviderRegistry.js";
import { createAssetModule } from "../generation/orchestration/createAssetModule.js";

const operation="modal-3d.asset.text_to_3d.v1";
const capabilityHash="sha256:cap01";
const capabilityRevision="caprev_01";
const sha=(bytes)=>`sha256:${createHash("sha256").update(bytes).digest("hex")}`;

function providerRegistry() {
  const registry=createDefaultProviderRegistry();
  registry.applyProviderSnapshot({
    revision:capabilityRevision,hash:capabilityHash,
    connector:{id:"unified-connector",instance:"instance_01",version:"1.0.0"},
    providers:[{
      id:"modal-3d",version:"1",status:"available",health:"healthy",contractVersion:"1",
      capabilities:[{
        operation,version:"1",displayName:"Text to 3D",status:"available",category:"asset-generation",
        input:{types:["text"]},output:{roles:["asset"]},execution:{async:true,durationClass:"long",costClass:"gpu"},
        prerequisites:{authMode:"connector-session",connection:true},support:{cancel:true,resume:true,idempotency:true}
      }]
    }]
  },{sourceId:"connector:unified-connector",sourceKind:"connector"});
  return registry;
}

function composedProviderRegistry() {
  const registry=createDefaultProviderRegistry();
  registry.applyProviderSnapshot({
    revision:capabilityRevision,hash:capabilityHash,
    connector:{id:"unified-connector",instance:"instance_01",version:"1.0.0"},
    providers:[
      {
        id:"modal-2d",version:"1",status:"available",health:"healthy",contractVersion:"1",
        capabilities:[{
          operation:"modal-2d.image.text_to_image.v1",version:"1",displayName:"Text to Image",status:"available",category:"image-generation",
          input:{types:["text"],schema:{type:"object",required:["prompt"],properties:{prompt:{type:"string"}}}},
          output:{roles:["primary-image"],required:["primary-image"]},profiles:{recommended:{}},
          execution:{async:true,durationClass:"medium",costClass:"gpu"},prerequisites:{authMode:"connector-session",connection:true},support:{cancel:true,resume:true,idempotency:true}
        }]
      },
      {
        id:"modal-3d",version:"1",status:"available",health:"healthy",contractVersion:"1",
        capabilities:[{
          operation:"modal-3d.asset.image_to_3d.v1",version:"1",displayName:"Image to 3D",status:"available",category:"asset-generation",
          input:{types:["image"],schema:{type:"object",required:["sourceArtifact","model"],properties:{sourceArtifact:{type:"object"},model:{type:"string",enum:["test-model"]},seed:{type:"integer",default:42}}}},
          output:{roles:["primary-glb"],required:["primary-glb"]},profiles:{recommended:{}},
          execution:{async:true,durationClass:"long",costClass:"gpu"},prerequisites:{authMode:"connector-session",connection:true},support:{cancel:true,resume:true,idempotency:true}
        }]
      }
    ]
  },{sourceId:"connector:unified-connector",sourceKind:"connector"});
  return registry;
}

function jobFrom(body,status="accepted",sequence=1,result=null) {
  return {
    id:"job_01",provider:body.provider,operation:body.operation,kind:"generation",
    requestHash:body.requestHash,idempotencyKey:body.idempotencyKey,contractVersion:body.contractVersion,
    capabilityHash:body.capabilityHash,capabilityRevision:body.capabilityRevision,
    status,attempt:1,relations:[],effectiveOptions:body.options||{},
    createdAt:"2026-08-25T00:00:00.000Z",updatedAt:`2026-08-25T00:00:0${sequence}.000Z`,
    completedAt:status==="succeeded"?`2026-08-25T00:00:0${sequence}.000Z`:null,
    eventSequence:sequence,result
  };
}

class CompilerStore {
  constructor(){ this.map=new Map(); }
  async put(key,bytes,metadata){ this.map.set(key,{bytes:new Uint8Array(bytes),metadata}); return key; }
  async get(key){ return this.map.get(key)||null; }
}

async function harness({remoteStatus="succeeded"}={}) {
  const bytes=new Uint8Array(await readFile("public/assets/cabinet.glb"));
  const artifactHash=sha(bytes);
  let submitted=null;
  const request=vi.fn(async(path,options={})=>{
    if (path==="/connector/v1/jobs" && options.method==="POST") {
      submitted=JSON.parse(options.body);
      return new Response(JSON.stringify({job:jobFrom(submitted)}),{status:200,headers:{"content-type":"application/json"}});
    }
    if (path==="/connector/v1/jobs/job_01") {
      const result=remoteStatus==="succeeded" ? {
        artifacts:[{id:"artifact_01",role:"asset",mime:"model/gltf-binary",bytes:bytes.byteLength,hash:artifactHash}]
      } : null;
      return new Response(JSON.stringify({job:jobFrom(submitted,remoteStatus,2,result)}),{status:200,headers:{"content-type":"application/json"}});
    }
    if (path==="/connector/v1/artifacts/artifact_01") {
      return new Response(bytes,{status:200,headers:{"content-type":"model/gltf-binary","content-length":String(bytes.byteLength)}});
    }
    throw new Error(`unexpected request ${path}`);
  });
  const connectorClient={
    request,
    session:()=>({status:"paired",connector:{id:"unified-connector",instance:"instance_01",version:"1.0.0"}})
  };
  const compilerStore=new CompilerStore();
  const compiler=new AssetCompiler({store:compilerStore,version:"as09-test"});
  const now=()=>Date.parse("2026-08-25T00:01:00.000Z");
  const assetModule=createAssetModule({manifests:{},compiledStore:compilerStore,now});
  assetModule.configurePublication({getAssetCompiler:async()=>compiler,idFactory:()=>"lease_generation_01"});
  const orchestrator=new GenerationOrchestrator({
    providerRegistry:providerRegistry(),connectorClient,
    artifactRegistry:assetModule.artifactRegistry,byteStore:assetModule.byteStore,publishAsset:assetModule.publishAsset,
    now
  });
  return {orchestrator,request,assets:assetModule.manager,assetModule,artifactHash};
}

const generationRequest=()=>({
  provider:"modal-3d",operation,inputs:{prompt:"cabinet"},options:{quality:"balanced"},outputRoles:["asset"]
});

describe("GenerationOrchestrator",()=>{
  it("preserves two-phase Connector pairing without treating approval as a browser secret",async()=>{
    const connectorClient={
      isPaired:vi.fn(()=>false),
      pair:vi.fn(async({pairingId}={})=>pairingId
        ? {status:"paired",session:{connector:{id:"unified-connector",instance:"instance_01",version:"1.0.0"}}}
        : {status:"approval_required",pairingId:"pair_01",connector:{id:"unified-connector",instance:"instance_01",version:"1.0.0"}}),
      session:vi.fn(()=>null)
    };
    const orchestrator=new GenerationOrchestrator({providerRegistry:providerRegistry(),connectorClient,jobClient:{},jobReconciler:{},artifactImporter:{}});
    await expect(orchestrator.initialize({pair:true})).resolves.toMatchObject({status:"connection-required",reason:"APPROVAL_REQUIRED",pairingId:"pair_01"});
    expect(connectorClient.pair).toHaveBeenCalledWith({pairingId:null});
  });
  it("lists normalized generation providers/capabilities without transport secrets",async()=>{
    const {orchestrator}=await harness();
    const providers=orchestrator.listGenerationProviders({availableOnly:true});
    const capabilities=orchestrator.listGenerationCapabilities({provider:"modal-3d",availableOnly:true});
    expect(providers.providers).toEqual([expect.objectContaining({id:"modal-3d",status:"available",operations:[operation],capabilityRevision})]);
    expect(capabilities.capabilities[0]).toMatchObject({provider:"modal-3d",operation,connectionRequired:true,capabilityHash});
    expect(JSON.stringify({providers,capabilities})).not.toMatch(/Authorization|Bearer|signedUrl|token|127\.0\.0\.1/i);
  });

  it("derives stable request identity and prevents duplicate paid submit locally",async()=>{
    const {orchestrator,request}=await harness();
    const first=await orchestrator.submitGenerationJob(generationRequest());
    const second=await orchestrator.submitGenerationJob(generationRequest());
    expect(first).toMatchObject({status:"generation-pending",jobId:"job_01",reused:false});
    expect(second).toMatchObject({status:"generation-pending",jobId:"job_01",reused:true});
    expect(request.mock.calls.filter(([path,options])=>path==="/connector/v1/jobs"&&options.method==="POST")).toHaveLength(1);
    await expect(orchestrator.submitGenerationJob({...generationRequest(),metadata:{apiKey:"must-not-cross"}}))
      .rejects.toMatchObject({code:"JOB_SECRET_FIELD"});
  });

  it("keeps provider success distinct from asset readiness and completes the verified vertical path",async()=>{
    const {orchestrator,assets,artifactHash}=await harness();
    const pending=await orchestrator.generateAndCompileAsset({...generationRequest(),assetId:"asset_generated_01",label:"Generated Cabinet"});
    expect(pending).toMatchObject({status:"generation-pending",jobId:"job_01",assetId:"asset_generated_01"});
    expect(assets.has("asset_generated_01")).toBe(false);

    const providerSucceeded=await orchestrator.getGenerationJob("job_01");
    expect(providerSucceeded).toMatchObject({status:"provider-succeeded",phase:"result_available",artifacts:[{id:"artifact_01",hash:artifactHash}]});
    expect(assets.has("asset_generated_01")).toBe(false);

    const produced=await orchestrator.generateAndCompileAsset({jobId:"job_01",assetId:"asset_generated_01",label:"Generated Cabinet"});
    expect(produced).toMatchObject({
      status:"asset-provisional",jobId:"job_01",providerStatus:"provider-succeeded",artifactStatus:"artifact-imported",
      artifactId:"artifact_01",assetId:"asset_generated_01",admission:{status:"provisional"}
    });
    expect(assets.has("asset_generated_01")).toBe(true);
    expect(orchestrator.artifactRegistry.get("artifact_01")).toMatchObject({integrity:{state:"verified"},hash:artifactHash});
  });

  it("composes text-to-image and image-to-3D into one verified asset production path",async()=>{
    const glbBytes=new Uint8Array(await readFile("public/assets/cabinet.glb"));
    const imageBytes=new Uint8Array([137,80,78,71,13,10,26,10]);
    const imageHash=sha(imageBytes),glbHash=sha(glbBytes);
    const submitted=new Map();
    const request=vi.fn(async(path,options={})=>{
      if(path==="/connector/v1/jobs" && options.method==="POST"){
        const body=JSON.parse(options.body);
        const id=body.provider==="modal-2d"?"job_image":"job_asset";
        submitted.set(id,body);
        return new Response(JSON.stringify({job:{...jobFrom(body),id}}),{status:200,headers:{"content-type":"application/json"}});
      }
      if(path==="/connector/v1/jobs/job_image"){
        const body=submitted.get("job_image");
        const result={artifacts:[{id:"artifact_image",role:"primary-image",mime:"image/png",bytes:imageBytes.byteLength,hash:imageHash}]};
        return new Response(JSON.stringify({job:{...jobFrom(body,"succeeded",2,result),id:"job_image"}}),{status:200,headers:{"content-type":"application/json"}});
      }
      if(path==="/connector/v1/jobs/job_asset"){
        const body=submitted.get("job_asset");
        const result={artifacts:[{id:"artifact_glb",role:"primary-glb",mime:"model/gltf-binary",bytes:glbBytes.byteLength,hash:glbHash}]};
        return new Response(JSON.stringify({job:{...jobFrom(body,"succeeded",2,result),id:"job_asset"}}),{status:200,headers:{"content-type":"application/json"}});
      }
      if(path==="/connector/v1/artifacts/artifact_glb") return new Response(glbBytes,{status:200,headers:{"content-type":"model/gltf-binary","content-length":String(glbBytes.byteLength)}});
      throw new Error(`unexpected request ${path}`);
    });
    const connectorClient={request,session:()=>({status:"paired",connector:{id:"unified-connector",instance:"instance_01",version:"1.0.0"}})};
    const compilerStore=new CompilerStore();
    const compiler=new AssetCompiler({store:compilerStore,version:"p19-test"});
    const assetModule=createAssetModule({manifests:{},compiledStore:compilerStore});
    assetModule.configurePublication({getAssetCompiler:async()=>compiler,idFactory:()=>"lease_generation_composed"});
    const assets=assetModule.manager;
    const orchestrator=new GenerationOrchestrator({
      providerRegistry:composedProviderRegistry(),connectorClient,
      artifactRegistry:assetModule.artifactRegistry,byteStore:assetModule.byteStore,publishAsset:assetModule.publishAsset,
      pollIntervalMs:0
    });

    expect(orchestrator.canGenerateTextAsset()).toBe(true);
    const produced=await orchestrator.generateTextAsset({prompt:"a red apple",assetId:"generated_apple_01",label:"Red Apple"});

    expect(produced).toMatchObject({assetId:"generated_apple_01",route:{kind:"text-image-3d",image:{provider:"modal-2d"},asset:{provider:"modal-3d"}},jobs:{image:"job_image",asset:"job_asset"}});
    expect(assets.has("generated_apple_01")).toBe(true);
    expect([...submitted.values()].map((body)=>body.provider)).toEqual(["modal-2d","modal-3d"]);
    expect(submitted.get("job_asset")).toMatchObject({
      inputs:{sourceArtifact:{id:"artifact_image",role:"primary-image",mime:"image/png",hash:imageHash},model:"test-model"},
      parent:{jobId:"job_image"},profile:"recommended",outputRoles:["primary-glb"]
    });
  });

  it("refuses import before provider success",async()=>{
    const {orchestrator}=await harness({remoteStatus:"running"});
    await orchestrator.submitGenerationJob(generationRequest());
    await expect(orchestrator.importGenerationResult("job_01")).rejects.toMatchObject({code:"JOB_NOT_READY"});
  });
});
