import { describe, expect, it } from 'vitest';
import {
  GenerationJobContractError,
  connectorJobPhase,
  connectorJobStatusIsRemoteTerminal,
  normalizeGenerationJobProjection,
  requireSafeJobId,
  sanitizeJobData
} from '../../generation/jobs/GenerationJobProjection.js';

const base=(overrides={})=>({
  id:'job_01',
  provider:'modal-3d',
  operation:'modal-3d.asset.image_to_3d.v1',
  kind:'generation',
  requestHash:'sha256:req01',
  idempotencyKey:'idem_01',
  contractVersion:'1',
  capabilityHash:'sha256:cap01',
  capabilityRevision:'caprev_01',
  status:'running',
  stage:'reconstructing',
  progress:{kind:'items',current:2,total:5,unit:'views',label:'multi-view'},
  attempt:1,
  relations:[],
  effectiveOptions:{profile:'standard'},
  model:{id:'model-a',revision:'rev-a'},
  workflow:{id:'workflow-a',revision:'rev-w'},
  createdAt:'2026-08-24T06:00:00.000Z',
  submittedAt:'2026-08-24T06:00:01.000Z',
  startedAt:'2026-08-24T06:00:02.000Z',
  updatedAt:'2026-08-24T06:00:03.000Z',
  eventSequence:3,
  ...overrides
});

describe('Generation Job projection truth',()=>{
  it('maps Connector statuses to AgentScape phases without inventing asset completion',()=>{
    const cases={
      accepted:'pending',queued:'pending',running:'pending',
      connection_required:'recoverable',cancel_requested:'cancelling',
      cancelled:'terminal_non_success',failed:'terminal_non_success',expired:'terminal_non_success',
      succeeded:'result_available'
    };
    for (const [status,phase] of Object.entries(cases)) {
      const job=normalizeGenerationJobProjection(base({status,eventSequence:4}));
      expect(job.phase).toBe(phase);
      expect(job).not.toHaveProperty('assetReady');
      expect(job).not.toHaveProperty('completed');
    }
    expect(connectorJobPhase('succeeded')).toBe('result_available');
    expect(connectorJobStatusIsRemoteTerminal('succeeded')).toBe(true);
  });

  it('projects only safe artifact identity and strips transient remote locations',()=>{
    const job=normalizeGenerationJobProjection(base({
      status:'succeeded',
      completedAt:'2026-08-24T06:03:00.000Z',
      eventSequence:9,
      result:{
        manifestId:'manifest_01',
        artifacts:[{
          id:'artifact_01',role:'primary_mesh',mime:'model/gltf-binary',bytes:1234,hash:'sha256:artifact',
          url:'https://signed.example/object?sig=temporary',providerCallId:'remote-call-7'
        }],
        remoteFunctionCallId:'provider-private'
      }
    }));
    expect(job.phase).toBe('result_available');
    expect(job.result).toEqual({
      manifestId:'manifest_01',
      artifacts:[{id:'artifact_01',role:'primary_mesh',mime:'model/gltf-binary',bytes:1234,hash:'sha256:artifact'}]
    });
    expect(JSON.stringify(job)).not.toContain('signed.example');
    expect(JSON.stringify(job)).not.toContain('remote-call-7');
  });

  it('keeps model/workflow as stable versioned references and strips provider-private fields',()=>{
    const job=normalizeGenerationJobProjection(base({
      model:{id:'model-a',version:'2',revision:'rev-a',privateEndpoint:'provider-internal'},
      workflow:{id:'workflow-a',version:'7',revision:'rev-w',remoteCallId:'remote-private'},
      providerPrivateState:{gpu:'hidden'}
    }));
    expect(job.model).toEqual({id:'model-a',version:'2',revision:'rev-a'});
    expect(job.workflow).toEqual({id:'workflow-a',version:'7',revision:'rev-w'});
    expect(JSON.stringify(job)).not.toContain('provider-internal');
    expect(JSON.stringify(job)).not.toContain('remote-private');
    expect(job).not.toHaveProperty('providerPrivateState');
  });

  it('rejects secret-like fields in safe request/provenance payloads',()=>{
    expect(()=>sanitizeJobData({nested:{apiKey:'secret'}},'options'))
      .toThrow(expect.objectContaining({code:'JOB_SECRET_FIELD'}));
    expect(()=>normalizeGenerationJobProjection(base({effectiveOptions:{Authorization:'Bearer secret'}})))
      .toThrow(expect.objectContaining({code:'JOB_SECRET_FIELD'}));
  });

  it('rejects unsafe Job IDs, unknown statuses and unstable operation IDs',()=>{
    for (const id of ['../job','job/child','job?x=1','']) {
      expect(()=>requireSafeJobId(id)).toThrow(GenerationJobContractError);
    }
    expect(()=>normalizeGenerationJobProjection(base({status:'provider_done'})))
      .toThrow(expect.objectContaining({code:'JOB_STATUS_UNKNOWN'}));
    expect(()=>normalizeGenerationJobProjection(base({operation:'image_to_3d'})))
      .toThrow(expect.objectContaining({code:'JOB_PROJECTION_INVALID'}));
  });

  it('keeps retry/fallback relationships as local Job identities only',()=>{
    const job=normalizeGenerationJobProjection(base({relations:[
      {type:'retry_of',jobId:'job_parent'},
      {type:'fallback_of',jobId:'job_strategy_a'}
    ]}));
    expect(job.relations).toEqual([
      {type:'retry_of',jobId:'job_parent'},
      {type:'fallback_of',jobId:'job_strategy_a'}
    ]);
  });
});
