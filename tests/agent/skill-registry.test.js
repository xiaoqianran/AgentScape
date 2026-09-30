import { describe, expect, it, vi } from 'vitest';
import { SkillRegistry } from '../../application/skills/SkillRegistry.js';
import { PolicyEngine } from '../../foundation/PolicyEngine.js';
import { TraceRecorder } from '../../foundation/TraceRecorder.js';

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


  it('rejects register without name or handler with a stable error', () => {
    const { registry } = setup();
    expect(() => registry.register({ handler: () => {} })).toThrow('Skill requires name and handler');
    expect(() => registry.register({ name: 'x' })).toThrow('Skill requires name and handler');
    expect(() => registry.register(null)).toThrow('Skill requires name and handler');
  });

  it('rejects duplicate skill names without replacing the original handler', () => {
    const { registry } = setup();
    const original = vi.fn();
    registry.register({ name: 'dup', handler: original });
    expect(() => registry.register({ name: 'dup', handler: () => 'replacement' })).toThrow('Skill already registered: dup');
    expect(registry.get('dup').handler).toBe(original);
  });

  it('pins the default skill contract snapshot', () => {
    const { registry } = setup();
    registry.register({ name: 'bare', description: 'bare', handler: () => {} });
    expect(registry.get('bare')).toMatchObject({
      version: '1.0.0',
      permissions: [],
      required: [],
      properties: {},
      mutates: false,
      history: true,
      manualMutation: false,
      batchable: true,
      auxiliary: false,
      agent: true
    });
  });

  it('keeps agent:false skills out of LLM definitions', () => {
    const { registry } = setup();
    registry.register({ name: 'exposed', handler: () => {} });
    registry.register({ name: 'internal', agent: false, handler: () => {} });
    expect(registry.definitions().map((item) => item.name)).toEqual(['exposed']);
  });

  it('forces additionalProperties:false on every published definition', () => {
    const { registry } = setup();
    registry.register({ name: 'a', properties: { x: { type: 'string' } }, handler: () => {} });
    registry.register({ name: 'b', handler: () => {} });
    for (const definition of registry.definitions()) {
      expect(definition.parameters.additionalProperties).toBe(false);
      expect(definition.parameters.type).toBe('object');
    }
  });

  it('rejects missing required fields before the handler runs', async () => {
    const { registry } = setup();
    const handler = vi.fn();
    registry.register({ name: 'needs', required: ['id'], handler });
    const result = await registry.invoke('needs', {});
    expect(result).toEqual({ success: false, error: { code: 'invalid_input', message: 'Missing required fields: id' } });
    expect(handler).not.toHaveBeenCalled();
  });

  it('fails custom validation with invalid_input before authorization and handler', async () => {
    const { registry, trace } = setup();
    const handler = vi.fn();
    registry.register({ name: 'checked', permissions: ['world.write'], validate: () => ({ ok: false, message: 'bad range' }), handler });
    const result = await registry.invoke('checked', {}, { profile: 'builder' });
    expect(result).toEqual({ success: false, error: { code: 'invalid_input', message: 'bad range' } });
    expect(handler).not.toHaveBeenCalled();
    expect(trace.list({ type: 'policy.decision' })).toHaveLength(0);
  });

  it('reports SKILL_NOT_FOUND for authorization of unknown skills', () => {
    const { registry } = setup();
    expect(registry.authorization('ghost', { profile: 'viewer' })).toMatchObject({ allow: false, missing: [], required: [], reason: 'SKILL_NOT_FOUND' });
  });

  it('does not wrap manualMutation skills in another runtime mutation', async () => {
    const { registry, runtime } = setup();
    registry.register({ name: 'manual', mutates: true, manualMutation: true, handler: () => 'ok' });
    const result = await registry.invoke('manual', {}, {});
    expect(result.result).toBe('ok');
    expect(runtime.mutate).not.toHaveBeenCalled();
  });

  it('skips history transactions when context.skipHistory is set', async () => {
    const { registry, runtime } = setup();
    registry.register({ name: 'silent', mutates: true, handler: () => 'ok' });
    const result = await registry.invoke('silent', {}, { skipHistory: true });
    expect(result.result).toBe('ok');
    expect(runtime.mutate).not.toHaveBeenCalled();
  });

  it('converts handler exceptions into {success:false,error} preserving code and message', async () => {
    const { registry } = setup();
    registry.register({ name: 'boom', handler: () => { throw Object.assign(new Error('kaput'), { code: 'E_KAPUT' }); } });
    const result = await registry.invoke('boom', {}, {});
    expect(result).toEqual({ success: false, error: { code: 'E_KAPUT', message: 'kaput' } });
    registry.register({ name: 'plain', handler: () => { throw new Error('no code'); } });
    const fallback = await registry.invoke('plain', {}, {});
    expect(fallback).toEqual({ success: false, error: { code: 'handler_error', message: 'no code' } });
  });

  it('classifies dropped as verified only when released, settled and not still held', () => {
    const { registry } = setup();
    registry.register({ name: 'drop', mutates: true, handler: () => {} });
    expect(registry.executionPolicy('drop', { status: 'dropped', released: true, settled: true, stillHeld: false }).outcome)
      .toMatchObject({ state: 'verified', verified: true, status: 'dropped' });
    for (const partial of [
      { status: 'dropped', released: false, settled: true, stillHeld: false },
      { status: 'dropped', released: true, settled: false, stillHeld: false },
      { status: 'dropped', released: true, settled: true, stillHeld: true }
    ]) {
      expect(registry.executionPolicy('drop', partial).outcome)
        .toMatchObject({ state: 'unverified', verified: false, status: 'dropped', reason: 'POST_CONDITION_NOT_VERIFIED' });
    }
  });

  it('gates recovery-cleaned verification on each of the four post-conditions', () => {
    const { registry } = setup();
    registry.register({ name: 'cleanup2', mutates: true, auxiliary: true, handler: () => {} });
    const base = { status: 'recovery-cleaned', released: true, settled: true, sweepClear: true, contactClear: true };
    for (const key of ['released', 'settled', 'sweepClear', 'contactClear']) {
      expect(registry.executionPolicy('cleanup2', { ...base, [key]: false }).outcome)
        .toMatchObject({ state: 'unverified', verified: false, reason: 'POST_CONDITION_NOT_VERIFIED' });
    }
  });

  it('rejects batching for blocked, failed, unverified, requested, error and noop outcomes', () => {
    const { registry } = setup();
    registry.register({ name: 'act2', mutates: true, handler: () => {} });
    const rejected = [
      { status: 'pickup-blocked' },
      { status: 'action-failed' },
      { status: 'action-unverified' },
      { requested: true },
      { error: 'network failed' },
      { status: 'recovery-stale' }
    ];
    for (const result of rejected) {
      expect(registry.executionPolicy('act2', result).batchAcceptable).toBe(false);
    }
    expect(registry.executionPolicy('act2', { status: 'action-completed', targetReached: true, settled: true }).batchAcceptable).toBe(true);
    expect(registry.executionPolicy('act2', { status: 'arrived' }).batchAcceptable).toBe(true);
  });

  it('classifies provider-succeeded and artifact-imported as unverified, never as completion', () => {
    const { registry } = setup();
    registry.register({ name: 'gen', mutates: true, handler: () => {} });
    for (const status of ['provider-succeeded', 'artifact-imported']) {
      expect(registry.executionPolicy('gen', { status })).toMatchObject({
        barrier: true, batchAcceptable: false,
        outcome: { state: 'unverified', verified: false, status }
      });
    }
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
