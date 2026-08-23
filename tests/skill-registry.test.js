import { describe, expect, it, vi } from 'vitest';
import { SkillRegistry } from '../src/skills/SkillRegistry.js';
import { PolicyEngine } from '../src/policy/PolicyEngine.js';
import { TraceRecorder } from '../src/observability/TraceRecorder.js';

function setup() {
  const trace = new TraceRecorder();
  const runtime = { mutate: vi.fn(async (_label, fn) => fn()) };
  const registry = new SkillRegistry({ policy: new PolicyEngine(), trace, runtime });
  return { registry, trace, runtime };
}

describe('SkillRegistry', () => {
  it('exports LLM tool schema from the same registered skill definition', () => {
    const { registry } = setup();
    registry.register({ name:'move', description:'move', required:['id'], properties:{ id:{type:'string'} }, handler:()=>{} });
    expect(registry.definitions()[0]).toEqual({ name:'move', description:'move', parameters:{ type:'object', properties:{id:{type:'string'}}, required:['id'], additionalProperties:false } });
  });

  it('validates, authorizes, executes and traces a skill', async () => {
    const { registry, trace } = setup();
    registry.register({ name: 'read', permissions: ['world.read'], handler: ({ x }) => x + 1 });
    const result = await registry.invoke('read', { x: 2 }, { profile: 'viewer', actor: 'a1' });
    expect(result).toEqual({ success: true, result: 3 });
    expect(trace.list({ type: 'policy.decision' })[0].payload.allow).toBe(true);
    expect(trace.list({ type: 'skill.executed' })[0].actor).toBe('a1');
  });

  it('blocks forbidden mutation before handler execution', async () => {
    const { registry } = setup();
    const handler = vi.fn();
    registry.register({ name: 'write', permissions: ['world.write'], mutates: true, handler });
    const result = await registry.invoke('write', {}, { profile: 'viewer' });
    expect(result.success).toBe(false);
    expect(result.error.code).toBe('forbidden');
    expect(handler).not.toHaveBeenCalled();
  });

  it('wraps mutating skills in runtime history transaction', async () => {
    const { registry, runtime } = setup();
    registry.register({ name: 'write', permissions: ['world.write'], mutates: true, handler: () => 'ok' });
    const result = await registry.invoke('write', {}, { profile: 'builder' });
    expect(result.result).toBe('ok');
    expect(runtime.mutate).toHaveBeenCalledOnce();
  });



  it('classifies mutation outcomes for deterministic sequencing without changing the LLM schema', () => {
    const { registry } = setup();
    registry.register({ name:'read', description:'read', handler:()=>({}) });
    registry.register({ name:'act', description:'act', mutates:true, batchable:false, handler:()=>({}) });
    expect(registry.executionPolicy('read',{status:'arrived'})).toMatchObject({mutates:false,barrier:false,batchable:true,outcome:{state:'verified',verified:true}});
    expect(registry.executionPolicy('act',{status:'action-failed',reason:'STALL'})).toMatchObject({mutates:true,barrier:true,batchable:false,batchAcceptable:false,outcome:{state:'failed',verified:false,reason:'STALL'}});
    expect(registry.executionPolicy('act',{status:'action-unverified',reason:'TIMEOUT'}).outcome.state).toBe('unverified');
    expect(registry.executionPolicy('act',{requested:true})).toMatchObject({batchAcceptable:false,outcome:{state:'requested',verified:false}});
    expect(registry.executionPolicy('act',{status:'action-completed',targetReached:true,settled:true})).toMatchObject({batchAcceptable:true,outcome:{state:'verified',verified:true}});
    expect(registry.executionPolicy('act',{status:'action-completed'})).toMatchObject({batchAcceptable:false,outcome:{state:'unverified',verified:false,reason:'POST_CONDITION_NOT_VERIFIED'}});
    expect(registry.executionPolicy('act',{status:'placed',supportVerified:true})).toMatchObject({batchAcceptable:false,outcome:{state:'unverified',verified:false}});
    expect(registry.definitions().find((item)=>item.name==='act')).not.toHaveProperty('mutates');
  });


  it('does not confuse numeric physics error metrics with tool exceptions', () => {
    const { registry } = setup();
    registry.register({name:'interact',mutates:true,handler:()=>{}});
    expect(registry.executionPolicy('interact',{status:'action-completed',targetReached:true,settled:true,error:0.000013})).toMatchObject({
      barrier:true,outcome:{state:'verified',verified:true,status:'action-completed'}
    });
    expect(registry.executionPolicy('interact',{error:'network failed',code:'TOOL_ERROR'})).toMatchObject({
      outcome:{state:'error',verified:false,reason:'TOOL_ERROR'}
    });
  });


  it('requires explicit embodied post-condition fields before classifying a mutation verified', () => {
    const { registry } = setup();
    registry.register({name:'act',mutates:true,handler:()=>{}});
    expect(registry.executionPolicy('act',{status:'action-completed'}).outcome).toMatchObject({state:'unverified',verified:false,reason:'POST_CONDITION_NOT_VERIFIED'});
    expect(registry.executionPolicy('act',{status:'action-completed',targetReached:true,settled:true}).outcome).toMatchObject({state:'verified',verified:true});
    expect(registry.executionPolicy('act',{status:'placed',supportVerified:true}).outcome).toMatchObject({state:'unverified',verified:false});
    expect(registry.executionPolicy('act',{status:'placed',supportVerified:true,settled:true}).outcome).toMatchObject({state:'verified',verified:true});
  });


  it('marks auxiliary recovery mutations as barriers without tracking them as task unresolved identities', () => {
    const { registry } = setup();
    registry.register({name:'recover',mutates:true,auxiliary:true,batchable:false,handler:()=>{}});
    expect(registry.executionPolicy('recover',{status:'pickup-blocked',reason:'APPROACH_FAILED'})).toMatchObject({
      mutates:true,barrier:true,auxiliary:true,tracksUnresolved:false,batchable:false,
      outcome:{state:'blocked',verified:false,reason:'APPROACH_FAILED'}
    });
    expect(registry.executionPolicy('recover',{status:'recovery-stale',reason:'CONTACT_EVIDENCE_STALE'})).toMatchObject({
      auxiliary:true,tracksUnresolved:false,outcome:{state:'noop',reason:'CONTACT_EVIDENCE_STALE'}
    });
  });


  it('exposes one authorization decision for proposal-time Policy checks',()=>{
    const policy=new PolicyEngine({profiles:{viewer:['world.read'],builder:['world.read','world.write']}});
    const registry=new SkillRegistry({policy});
    registry.register({name:'write',permissions:['world.write'],handler:()=>{}});
    expect(registry.authorization('write',{profile:'builder'})).toMatchObject({allow:true,profile:'builder',missing:[],required:['world.write']});
    expect(registry.authorization('write',{profile:'viewer'})).toMatchObject({allow:false,profile:'viewer',missing:['world.write'],required:['world.write']});
  });


  it('verifies recovery cleanup only when release, settle, sweep and contact post-conditions all hold',()=>{
    const {registry}=setup();
    registry.register({name:'cleanup',mutates:true,auxiliary:true,handler:()=>{}});
    expect(registry.executionPolicy('cleanup',{status:'recovery-cleaned',released:true,settled:true,sweepClear:true,contactClear:true})).toMatchObject({
      auxiliary:true,tracksUnresolved:false,outcome:{state:'verified',verified:true,status:'recovery-cleaned'}
    });
    expect(registry.executionPolicy('cleanup',{status:'recovery-cleaned',released:true,settled:true,sweepClear:false,contactClear:true})).toMatchObject({
      outcome:{state:'unverified',verified:false,status:'recovery-cleaned',reason:'POST_CONDITION_NOT_VERIFIED'}
    });
  });

});
