import { it, expect, vi } from 'vitest';
import * as THREE from 'three';
import { buildCodeProject } from '../../dev/build-code-project.mjs';
import { openCodeProject, parseCodeProject } from '../../application/native-scene/CodeProject.js';
import { AgentTools } from '../../application/AgentTools.js';
import { ToolCallingAgent } from '../../modules/agent/ToolCallingAgent.js';

const fixture = () => buildCodeProject({ entry: 'examples/code-project/project.js', id: 'portal', name: 'Portal' });

it('runs a multi-file Three project, discovers new actions and restores source/state/Runtime assets in a fresh session', async () => {
  const project = await fixture();
  const host = await openCodeProject({ project, authorized: true, autoStart: false });
  let fresh;
  try {
    const ring = host.scene.native.scene.getObjectByName('ProjectPortal');
    expect(ring).toBeInstanceOf(THREE.Mesh); expect(ring.material.isShaderMaterial).toBe(true);
    host.frame(0); host.frame(1000);
    expect(ring.material.uniforms.time.value).toBe(1);
    expect(host.scene.observe().project.total).toBe(2);
    expect(host.scene.inspect('portal').actions.find(a => a.name === 'teleport')).toMatchObject({ action: 'custom', execution: 'project-action', verification: 'project-defined' });
    const tools = new AgentTools(host.world);
    const action = await tools.call('interactScene', { interaction: { action: 'custom', target: 'portal', name: 'teleport', args: { destination: 'garden' } } });
    expect(action).toMatchObject({ status: 'succeeded', verification: { status: 'verified' }, value: { physicsVerified: false } });
    expect(host.scene.inspect('traveller').state.zone).toBe('garden');
    const criteria = [{ id: 'arrived', kind: 'state-equals', targetId: 'traveller', stateKey: 'zone', value: 'garden' }];
    expect(host.scene.verify(criteria).value.status).toBe('world-accepted');
    expect((await tools.call('planSceneTask', { criteria })).status).toBe('scene-task-plan');
    const pulse = await tools.call('interactScene', { interaction: { action: 'custom', target: 'portal', name: 'pulse', args: { brightness: 2 } } });
    expect(pulse).toMatchObject({ status: 'succeeded', verification: { status: 'unverified' } });
    expect(tools.executionPolicy('interactScene', pulse).outcome).toMatchObject({ state: 'accepted', verified: false });
    await host.scene.addModel({ id: 'cup', asset: 'builtin://cup', position: [2, 2, 0] });
    const recipe = { schema: 'agentscape.asset-recipe', schemaVersion: 1, id: 'example/persisted', parts: [{ id: 'body', geometry: { type: 'box', size: [.2, .2, .2] } }] };
    await host.scene.addModel({ id: 'generated', asset: recipe });
    const saved = await host.scene.save();
    expect(saved.value.runtime.assets.length).toBe(1);
    const tampered = structuredClone(saved.value); tampered.source += '\n// edit';
    await expect(parseCodeProject(tampered)).rejects.toThrow('CODE_PROJECT_INTEGRITY_MISMATCH');
    fresh = await openCodeProject({ project: JSON.stringify(saved.value), authorized: true, autoStart: false });
    expect(fresh.scene.inspect('traveller').state.zone).toBe('garden');
    expect(fresh.scene.inspect('portal').state).toMatchObject({ uses: 1, pulse: 2 });
    expect(fresh.scene.observe().objects.map(o => o.id)).toEqual(['cup', 'generated']);
    const again = fresh.scene.interact({ action: 'custom', target: 'portal', name: 'teleport', args: { destination: 'entrance' } });
    expect(await fresh.scene.waitJob(again.id)).toMatchObject({ status: 'succeeded', result: { verification: { status: 'verified' } } });
    expect(fresh.scene.inspect('traveller').state.zone).toBe('entrance');
  } finally { host.close(); fresh?.close(); }
}, 30000);

it('rejects invalid arguments before side effects and cooperatively cancels a custom action without releasing its lock early', async () => {
  const host = await openCodeProject({ project: await fixture(), authorized: true, autoStart: false });
  try {
    const bad = host.scene.interact({ action: 'custom', target: 'portal', name: 'teleport', args: { destination: 'unknown' } });
    expect(await host.scene.waitJob(bad.id)).toMatchObject({ status: 'failed', result: { diagnostics: [{ code: 'PROJECT_ACTION_ARGUMENTS_INVALID' }] } });
    expect(host.scene.inspect('portal').state.uses).toBe(0);
    let release, cancelled = false;
    host.scene.registerAction({ target: 'portal', name: 'long-operation', execute: async (_, { signal }) => {
      await new Promise(resolve => { release = resolve; signal.addEventListener('abort', () => { cancelled = true; resolve(); }, { once: true }); });
    } });
    const job = host.scene.interact({ action: 'custom', target: 'portal', name: 'long-operation' });
    await Promise.resolve(); expect(release).toBeTypeOf('function');
    expect(() => host.close()).toThrow('SCENE_BUSY');
    await expect(host.scene.save()).rejects.toThrow('SCENE_BUSY');
    host.scene.cancelJob(job.id);
    expect(await host.scene.waitJob(job.id)).toMatchObject({ status: 'cancelled', result: { verification: { status: 'unverified' } } });
    expect(cancelled).toBe(true);
    host.frame(100); // The project still runs after cancellation.
  } finally { host.close(); }
}, 30000);

it('keeps unverified behavior executable, isolates metadata and handles unavailable/throwing actions', async () => {
  const host = await openCodeProject({ project: await fixture(), authorized: true, autoStart: false });
  try {
    const schema = { type: 'object', properties: { count: { type: 'number', minimum: 1 } }, required: ['count'], additionalProperties: false };
    const execute = vi.fn();
    const remove = host.scene.registerAction({ target: 'portal', name: 'new-action', parameters: schema, execute, available: () => false });
    schema.properties.count.minimum = -100;
    expect(host.scene.inspect('portal').actions.find(a => a.name === 'new-action').parameters.properties.count.minimum).toBe(1);
    const job = host.scene.interact({ action: 'custom', target: 'portal', name: 'new-action', args: { count: 2 } });
    expect(await host.scene.waitJob(job.id)).toMatchObject({ status: 'failed', result: { diagnostics: [{ code: 'PROJECT_ACTION_UNAVAILABLE' }] } }); expect(execute).not.toHaveBeenCalled();
    remove(); remove();
    expect(host.scene.inspect('portal').actions.some(a => a.name === 'new-action')).toBe(false);
    host.scene.registerAction({ target: 'portal', name: 'throw', execute() { throw new Error('broken'); } });
    const failed = host.scene.interact({ action: 'custom', target: 'portal', name: 'throw' });
    expect(await host.scene.waitJob(failed.id)).toMatchObject({ status: 'failed' });
    const good = host.scene.interact({ action: 'custom', target: 'portal', name: 'pulse', args: { brightness: 1 } });
    expect(await host.scene.waitJob(good.id)).toMatchObject({ status: 'succeeded' });
    host.scene.registerAction({ target: 'portal', name: 'extend', timeoutMs: null, execute() {
      host.scene.registerAction({ target: 'portal', name: 'newly-created', execute: () => ({ created: true }) });
    } });
    expect(host.world.projectCapabilities.timeoutFor('portal', 'extend')).toBeNull();
    const extend = host.scene.interact({ action: 'custom', target: 'portal', name: 'extend' });
    expect((await host.scene.waitJob(extend.id)).status).toBe('succeeded');
    const created = host.scene.interact({ action: 'custom', target: 'portal', name: 'newly-created' });
    expect(await host.scene.waitJob(created.id)).toMatchObject({ status: 'succeeded', result: { value: { value: { created: true } } } });
    host.scene.registerAction({ target: 'portal', name: 'verification-fails', execute() {}, verify: () => false });
    const rejected = host.scene.interact({ action: 'custom', target: 'portal', name: 'verification-fails' });
    const rejectedResult = (await host.scene.waitJob(rejected.id)).result;
    expect(rejectedResult).toMatchObject({ status: 'succeeded', verification: { status: 'unverified' }, outcome: { state: 'unverified' } });
    expect(new AgentTools(host.world).executionPolicy('interactScene', rejectedResult).outcome.state).toBe('unverified');
  } finally { host.close(); }
});

it('requires explicit trusted execution and never imports source during inspection', async () => {
  const project = await fixture(), loader = vi.fn();
  expect((await parseCodeProject(project)).id).toBe('portal');
  await expect(openCodeProject({ project, loadModule: loader })).rejects.toThrow('CODE_EXECUTION_AUTHORIZATION_REQUIRED');
  expect(loader).not.toHaveBeenCalled();
  await expect(parseCodeProject(project, { maxBytes: 10 })).rejects.toThrow('CODE_PROJECT_LIMIT');
});

it('lets the real Agent loop discover and invoke a new nonphysical action without selecting a physical actor', async () => {
  const host = await openCodeProject({ project: await fixture(), authorized: true, autoStart: false });
  try {
    const seen = [];
    const responses = [
      { message: '', toolCalls: [{ id: 'plan', name: 'planSceneTask', args: { criteria: [{ id: 'arrival', kind: 'state-equals', targetId: 'traveller', stateKey: 'zone', value: 'garden' }] } }] },
      { message: '', toolCalls: [{ id: 'act', name: 'interactScene', args: { goalId: 'arrival', interaction: { action: 'custom', target: 'portal', name: 'teleport', args: { destination: 'garden' } } } }] },
      { message: '旅行者已到达花园。', toolCalls: [] },
    ];
    const gateway = { isConfigured: () => true, complete: async request => { seen.push(request.context.scene); return responses.shift() || { message: '', toolCalls: [] }; } };
    const agent = new ToolCallingAgent({ tools: new AgentTools(host.world), gateway, maxSteps: 5 });
    const result = await agent.run('通过传送门把旅行者送到花园');
    expect(result.taskStatus).toBe('completed');
    expect(result.execution.some(step => step.tool === 'interactScene' && step.executed)).toBe(true);
    expect(seen[0].project.entities.find(entity => entity.id === 'portal').actions.map(action => action.name)).toContain('teleport');
    expect(host.scene.inspect('traveller').state.zone).toBe('garden');
  } finally { host.close(); }
});

it('embeds resources and rebuilds their URLs after restoring only portable bytes', async () => {
  const project = { schema: 'agentscape.code-project', schemaVersion: 1, id: 'resources', name: 'Resources',
    resources: { 'message.txt': { mime: 'text/plain', base64: btoa('portable resource') } },
    source: `let builds=0; export async function createProject({THREE,resource}) {
      builds++;
      const text=await (await fetch(resource('message.txt'))).text();
      return {scene:new THREE.Scene(),camera:new THREE.PerspectiveCamera(),renderer:{render(){},extensions:{has:()=>false}},
        setup({scene}){scene.registerEntity({id:'message',read:()=>({text,builds})});},serialize(){return {text};}};
    }` };
  const first = await openCodeProject({ project, authorized: true, autoStart: false });
  let fresh;
  try {
    expect(first.scene.inspect('message').state.text).toBe('portable resource');
    const saved = (await first.save()).value;
    first.close();
    fresh = await openCodeProject({ project: saved, authorized: true, autoStart: false });
    expect(fresh.scene.inspect('message').state.text).toBe('portable resource');
    expect(fresh.scene.inspect('message').state.builds).toBe(1);
  } finally { first.close(); fresh?.close(); }
});

it('holds the save lock and pauses project updates during asynchronous state capture', async () => {
  let resolveState, updates = 0;
  const instance = { scene: new THREE.Scene(), camera: new THREE.PerspectiveCamera(),
    renderer: { render() {}, extensions: { has: () => false } },
    update() { updates++; }, serialize: () => new Promise(resolve => { resolveState = resolve; }) };
  const host = await openCodeProject({ project: await fixture(), authorized: true, autoStart: false, loadModule: async () => ({ createProject: () => instance }) });
  try {
    const pending = host.save();
    await Promise.resolve();
    host.frame(0); host.frame(1000);
    expect(updates).toBe(0);
    expect(() => host.scene.interact({ action: 'custom', target: 'portal', name: 'teleport' })).toThrow('SCENE_BUSY');
    resolveState({ saved: true }); await pending;
    host.frame(2000); expect(updates).toBe(1);
  } finally { host.close(); }
});

it('cleans up a failed project setup and leaves another running project untouched', async () => {
  const working = await openCodeProject({ project: await fixture(), authorized: true, autoStart: false });
  const dispose = vi.fn(), native = new THREE.Scene();
  try {
    await expect(openCodeProject({ project: await fixture(), authorized: true, autoStart: false,
      loadModule: async () => ({ createProject: () => ({ scene: native, camera: new THREE.PerspectiveCamera(), renderer: { render() {}, extensions: { has: () => false } },
        setup() { throw new Error('SETUP_FAILED'); }, dispose }) }) })).rejects.toThrow('SETUP_FAILED');
    expect(dispose).toHaveBeenCalledOnce();
    expect(native.children).toHaveLength(0);
    expect(working.scene.inspect('portal').state.uses).toBe(0);
    const job = working.scene.interact({ action: 'custom', target: 'portal', name: 'pulse', args: { brightness: 1 } });
    expect((await working.scene.waitJob(job.id)).status).toBe('succeeded');
  } finally { working.close(); }
});
