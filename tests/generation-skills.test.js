import { describe, expect, it, vi } from "vitest";
import { PolicyEngine } from "../src/policy/PolicyEngine.js";
import { SkillRegistry } from "../src/skills/SkillRegistry.js";
import { registerCoreSkills } from "../src/skills/registerCoreSkills.js";

function setup() {
  const generation={
    listGenerationProviders:vi.fn(()=>({status:"providers-listed",providers:[]})),
    listGenerationCapabilities:vi.fn(()=>({status:"capabilities-listed",capabilities:[]})),
    submitGenerationJob:vi.fn(async()=>({status:"generation-pending",jobId:"job_01",phase:"pending"})),
    getGenerationJob:vi.fn(async()=>({status:"provider-succeeded",jobId:"job_01",phase:"result_available"})),
    cancelGenerationJob:vi.fn(async()=>({status:"generation-cancelling",jobId:"job_01",phase:"cancelling"})),
    importGenerationResult:vi.fn(async()=>({status:"artifact-imported",jobId:"job_01",artifact:{id:"artifact_01",integrity:"verified"}})),
    generateAndCompileAsset:vi.fn(async()=>({status:"asset-provisional",jobId:"job_01",assetId:"asset_01"}))
  };
  const runtime={
    generation,
    policy:new PolicyEngine(),
    trace:{emit:vi.fn()},
    mutate:vi.fn(async(_label,fn)=>fn())
  };
  const registry=registerCoreSkills(new SkillRegistry({policy:runtime.policy,trace:runtime.trace,runtime}),runtime);
  return {runtime,generation,registry};
}

const GENERATION_SKILLS=[
  "listGenerationProviders","listGenerationCapabilities","submitGenerationJob","getGenerationJob",
  "cancelGenerationJob","importGenerationResult","generateAndCompileAsset"
];

describe("Agent-visible generation skills",()=>{
  it("exposes the AS-09 tool surface as thin Agent tools",()=>{
    const {registry}=setup();
    const names=new Set(registry.definitions().map((item)=>item.name));
    for (const name of GENERATION_SKILLS) expect(names.has(name)).toBe(true);
    expect(registry.get("submitGenerationJob").mutates).toBe(false);
    expect(registry.get("cancelGenerationJob").mutates).toBe(false);
    expect(registry.get("generateAndCompileAsset").mutates).toBe(false);
    expect(registry.get("submitGenerationJob").batchable).toBe(false);
  });

  it("separates read access from submit/cancel/import permissions",async()=>{
    const {registry,generation}=setup();
    await expect(registry.invoke("listGenerationProviders",{}, {profile:"viewer"}))
      .resolves.toMatchObject({success:true,result:{status:"providers-listed"}});
    await expect(registry.invoke("getGenerationJob",{jobId:"job_01"},{profile:"viewer"}))
      .resolves.toMatchObject({success:true,result:{status:"provider-succeeded"}});
    for (const [name,args] of [
      ["submitGenerationJob",{provider:"modal-3d",operation:"modal-3d.asset.text_to_3d.v1"}],
      ["cancelGenerationJob",{jobId:"job_01"}],
      ["importGenerationResult",{jobId:"job_01"}],
      ["generateAndCompileAsset",{jobId:"job_01",assetId:"asset_01"}]
    ]) {
      const result=await registry.invoke(name,args,{profile:"viewer"});
      expect(result).toMatchObject({success:false,error:{code:"forbidden"}});
    }
    expect(generation.submitGenerationJob).not.toHaveBeenCalled();
    expect(generation.cancelGenerationJob).not.toHaveBeenCalled();
    expect(generation.importGenerationResult).not.toHaveBeenCalled();
    expect(generation.generateAndCompileAsset).not.toHaveBeenCalled();
  });

  it("rejects secret-like generation fields before execution or tracing",async()=>{
    const {registry,generation,runtime}=setup();
    const result=await registry.invoke("submitGenerationJob",{
      provider:"modal-3d",operation:"modal-3d.asset.text_to_3d.v1",metadata:{apiKey:"must-not-cross"}
    },{profile:"builder"});
    expect(result).toMatchObject({success:false,error:{code:"invalid_input"}});
    expect(generation.submitGenerationJob).not.toHaveBeenCalled();
    expect(runtime.trace.emit).not.toHaveBeenCalled();
  });

  it("does not wrap external Job/Artifact orchestration in world history mutations",async()=>{
    const {registry,runtime}=setup();
    const submit=await registry.invoke("submitGenerationJob",{
      provider:"modal-3d",operation:"modal-3d.asset.text_to_3d.v1",inputs:{prompt:"cabinet"}
    },{profile:"builder"});
    const cancel=await registry.invoke("cancelGenerationJob",{jobId:"job_01"},{profile:"builder"});
    const imported=await registry.invoke("importGenerationResult",{jobId:"job_01"},{profile:"builder"});
    expect(submit.result.status).toBe("generation-pending");
    expect(cancel.result.status).toBe("generation-cancelling");
    expect(imported.result.status).toBe("artifact-imported");
    expect(runtime.mutate).not.toHaveBeenCalled();
  });

  it("never classifies provider success or artifact import as verified asset truth",()=>{
    const {registry}=setup();
    expect(registry.executionPolicy("submitGenerationJob",{status:"generation-pending"}).outcome)
      .toMatchObject({state:"requested",verified:false});
    expect(registry.executionPolicy("getGenerationJob",{status:"provider-succeeded"}).outcome)
      .toMatchObject({state:"unverified",verified:false});
    expect(registry.executionPolicy("importGenerationResult",{status:"artifact-imported"}).outcome)
      .toMatchObject({state:"unverified",verified:false});
    expect(registry.executionPolicy("generateAndCompileAsset",{status:"asset-provisional"}).outcome)
      .toMatchObject({state:"unverified",verified:false});
    expect(registry.executionPolicy("generateAndCompileAsset",{status:"asset-ready"}).outcome)
      .toMatchObject({state:"verified",verified:true});
  });
});
