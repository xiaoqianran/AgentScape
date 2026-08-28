import { describe,expect,it,vi } from 'vitest';
import { GenerationOrchestrator } from '../src/authoring/GenerationOrchestrator.js';
import { createDefaultProviderRegistry } from '../src/providers/ProviderRegistry.js';

const job={
  id:'job_01',provider:'modal-3d',operation:'modal-3d.asset.text_to_3d.v1',status:'running',phase:'executing',stage:'mesh',progress:{value:0.5},attempt:1,
  relations:[{type:'parent',jobId:'job_parent'}],createdAt:'2026-08-25T00:00:00.000Z',updatedAt:'2026-08-25T00:01:00.000Z',
  capabilityHash:'sha256:cap',capabilityRevision:'rev1',effectiveOptions:{quality:'high',token:'must-not-cross'},result:null,error:null
};

function setup(){
  let paired=true;
  const connectorClient={isPaired:()=>paired,session:()=>paired?{status:'paired',connector:{id:'unified-connector',instance:'local',version:'1'}}:null,request:vi.fn(),revoke:vi.fn(async()=>{paired=false;return {status:'revoked'};})};
  const jobClient={listCached:vi.fn(()=>[job])};
  const jobReconciler={bootstrap:vi.fn(async()=>({state:'ready',jobs:[job],eventCursor:4}))};
  const capabilityAdapter={refresh:vi.fn(async()=>({snapshot:{revision:'rev2',providers:[]}}))};
  const orchestrator=new GenerationOrchestrator({providerRegistry:createDefaultProviderRegistry(),connectorClient,jobClient,jobReconciler,capabilityAdapter});
  return {orchestrator,connectorClient,jobReconciler};
}

describe('GenerationOrchestrator Job Center control plane',()=>{
  it('lists only sanitized cached projections with relations',()=>{
    const {orchestrator}=setup();
    const result=orchestrator.listGenerationJobs();
    expect(result).toMatchObject({status:'jobs-listed',jobs:[{jobId:'job_01',status:'generation-pending',stage:'mesh',relations:[{type:'parent',jobId:'job_parent'}]}]});
    expect(JSON.stringify(result)).not.toMatch(/must-not-cross|effectiveOptions|token/);
  });

  it('reconciles through the existing reconciler instead of a UI state machine',async()=>{
    const {orchestrator,jobReconciler}=setup();
    const result=await orchestrator.reconcileGenerationJobs();
    expect(jobReconciler.bootstrap).toHaveBeenCalledOnce();
    expect(result).toMatchObject({status:'jobs-reconciled',eventCursor:4,jobs:[{jobId:'job_01',phase:'executing'}]});
  });

  it('exposes safe connector status and revocation',async()=>{
    const {orchestrator,connectorClient}=setup();
    expect(orchestrator.connectorStatus()).toMatchObject({status:'paired',connector:{id:'unified-connector',version:'1'}});
    expect(await orchestrator.revokeConnector()).toEqual({status:'connection-required',reason:'REVOKED'});
    expect(connectorClient.revoke).toHaveBeenCalledOnce();
    expect(orchestrator.connectorStatus().status).toBe('connection-required');
  });
});
