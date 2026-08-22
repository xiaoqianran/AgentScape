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
});
