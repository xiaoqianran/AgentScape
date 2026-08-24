import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { describe, expect, it, vi } from "vitest";
import { AssetCompiler } from "../src/compiler/AssetCompiler.js";
import { GenerationOrchestrator } from "../src/generation/GenerationOrchestrator.js";
import { createDefaultProviderRegistry } from "../src/providers/ProviderRegistry.js";
import { AssetManager } from "../src/runtime/AssetManager.js";

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
  const assets=new AssetManager({manifests:{},compiledStore:new CompilerStore()});
  const compilerStore=new CompilerStore();
  const compiler=new AssetCompiler({store:compilerStore,version:"as09-test"});
  const orchestrator=new GenerationOrchestrator({
    providerRegistry:providerRegistry(),connectorClient,assetManager:assets,getAssetCompiler:async()=>compiler,
    now:()=>Date.parse("2026-08-25T00:01:00.000Z")
  });
  return {orchestrator,request,assets,artifactHash};
}

const generationRequest=()=>({
  provider:"modal-3d",operation,inputs:{prompt:"cabinet"},options:{quality:"balanced"},outputRoles:["asset"]
});

describe("GenerationOrchestrator",()=>{
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

  it("refuses import before provider success",async()=>{
    const {orchestrator}=await harness({remoteStatus:"running"});
    await orchestrator.submitGenerationJob(generationRequest());
    await expect(orchestrator.importGenerationResult("job_01")).rejects.toMatchObject({code:"JOB_NOT_READY"});
  });
});
