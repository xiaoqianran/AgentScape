import { it, expect } from 'vitest';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { startServer } from '../../apps/mcp-server/main.mjs';
import { openScenePackage } from '../../application/scene/ScenePackage.js';
import { createCabinAffordances } from '../../modules/world/content/magic-cabin/affordances.js';
import {compileRecipeGeometry} from '../../modules/asset/production/AssetRecipe.js';

it('shares Scene edits with legacy observation and returns real asynchronous job evidence', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'agentscape-scene-'));
  const token = randomBytes(32).toString('hex');
  const app = await startServer({ tokens: [{ identity: 'scene-test', token }], port: 0, root });
  const client = new Client({ name: 'scene', version: '1' });
  const call = async (name, args = {}) => {
    const response = await client.callTool({ name, arguments: args });
    const result = JSON.parse(response.content[0].text);
    expect(response.isError, JSON.stringify(result)).toBeFalsy();
    return result;
  };
  try {
    await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${app.port}/mcp`), { requestInit: { headers: { Authorization: `Bearer ${token}` } } }));
    const session = await call('session_create'), base = { worldSessionId: session.worldSessionId };
    const missing = await client.callTool({ name: 'scene_observe', arguments: { ...base, target: 'missing' } });
    expect(missing.isError).toBe(true);
    expect(missing.content[0].text).toContain('OBJECT_NOT_FOUND');
    const far = await call('scene_observe', { ...base, target: 'cup_01', actor: 'agent_01' });
    expect(far.actions.find(action => action.action === 'pickup')).toMatchObject({ available: false, reason: 'OUT_OF_REACH' });
    expect((await call('scene_observe', { ...base, target: 'cup_01' })).actions.find(action => action.action === 'pickup').available).toBeNull();
    // Install a production environment adapter as a fixture; assertions use the HTTP MCP client.
    const host = app.manager.sessions.get(session.worldSessionId).host;
    let lampOn = false;
    host.world.environment.affordances = createCabinAffordances({ hinges: [], texts: [], drawers: [], books: [], switches: [
      { id: 'test:lamp', label: 'Lamp', position: [0, 1.2, 8.5], get: () => lampOn, set: value => { lampOn = value; } }
    ] });
    const lamp = await call('scene_observe', { ...base, target: 'test:lamp', actor: 'agent_01' });
    expect(lamp).toMatchObject({ source: 'environment', state: { on: false }, physicsVerified: false });
    expect(lamp.actions[0]).toMatchObject({ execution: 'world-action', available: true });
    const lampJob = await call('scene_interact', { ...base, requestId: randomUUID(), interaction:{ actor:'agent_01',target:'test:lamp',action:'turn_on' } });
    let lampResult;
    for(let poll=0;poll<70;poll++) {
      lampResult=await call('scene_job', { ...base, jobId:lampJob.id });
      if(lampResult.status!=='running')break;
      await new Promise(resolve=>setTimeout(resolve,5));
    }
    expect(lampResult).toMatchObject({status:'succeeded',result:{verification:{status:'verified'},value:{evidenceKind:'device-state',physicsVerified:false}}});
    expect((await call('scene_observe', { ...base, target: 'test:lamp' })).state.on).toBe(true);
    expect((await call('scene_verify',{...base,criteria:[{id:'lamp-on',kind:'state-equals',targetId:'test:lamp',stateKey:'on',value:true}]})).value.status).toBe('world-accepted');
    const alternatives=await call('scene_verify',{...base,criteria:[{id:'support',kind:'relation-exists',subject:'cup_01',predicate:'ON',objectAnyOf:['cabinet_01','table_01']}]});
    expect(alternatives.value.checks[0].objectAnyOf).toEqual(['cabinet_01','table_01']);
    host.world.environment.affordances = [];
    await call('scene_add_model', { ...base, requestId: randomUUID(), model: { id: 'held_test', asset: 'builtin://cup', position: [0, 0, 8] } });
    host.world.interactions.pickup('held_test');
    const held = await call('scene_observe', { ...base, target: 'held_test', actor: 'agent_01' });
    expect(held.actions.find(action => action.action === 'pickup')).toMatchObject({ available: false, reason: 'OBJECT_ALREADY_HELD' });
    expect(held.actions.find(action => action.action === 'setTransform')).toMatchObject({ available: false, reason: 'OBJECT_HELD' });
    host.world.interactions.drop('held_test');
    await call('scene_apply', { ...base, requestId: randomUUID(), operations: [{ type: 'remove', id: 'held_test' }] });
    const binary=await compileRecipeGeometry({
      schema:'agentscape.asset-recipe',schemaVersion:1,id:'mcp/novel_box',
      parts:[{id:'box',geometry:{type:'box',size:[.4,.4,.4]},position:[0,.2,0]}],
    });
    const source={kind:'glb',name:'external_box.glb',bytesBase64:Buffer.from(binary.bytes).toString('base64')};
    const proposal=await call('scene_add_model',{...base,requestId:randomUUID(),mode:'prepare',model:{asset:source}});
    expect(proposal.operations.every(action=>!action.executable && !action.physicsVerified)).toBe(true);
    expect((await call('world_observe',base)).objects).toHaveLength(4);
    await call('scene_add_model', { ...base, requestId: randomUUID(), model: { id:'novel_box', position:[.65,0,9], asset:{...source,
      review:{proposalId:proposal.proposalId,confirmed:true,physics:{body:'dynamic',mass:2,friction:.5},parts:[]}
    } } });
    const discovered = await call('scene_observe', { ...base, target:'novel_box', actor:'agent_01' });
    expect(discovered.actions.find(action=>action.action==='push')).toMatchObject({available:true});
    const push = await call('scene_interact', { ...base, requestId:randomUUID(), interaction:{
      actor:'agent_01',target:'novel_box',action:'push',args:{direction:[1,0,0],distance:1}
    } });
    let pushed;
    for(let poll=0;poll<200;poll++) {
      pushed = await call('scene_job', { ...base, jobId:push.id });
      if(pushed.status !== 'running') break;
      await new Promise(resolve=>setTimeout(resolve,5));
    }
    expect(pushed,JSON.stringify(pushed)).toMatchObject({status:'succeeded',result:{value:{physicsVerified:true,evidenceKind:'rigid-body-force'},verification:{status:'verified'}}});
    expect(pushed.result.value.finalPosition[0]-pushed.result.value.initialPosition[0]).toBeCloseTo(1,1);
    await call('scene_apply', { ...base, requestId:randomUUID(), operations:[{type:'remove',id:'novel_box'}] });
    const added = await call('scene_add_model', { ...base, requestId: randomUUID(), model: { id: 'visual', asset: { schema: 'agentscape.asset-recipe', schemaVersion: 1, id: 'example/visual', parts: [{ id: 'body', geometry: { type: 'box', size: [1, 1, 1] } }] } } });
    expect(added.verification.status).toBe('not-requested');
    expect((await call('scene_observe', base)).objects.find(object => object.id === 'visual').physicsRegistered).toBe(false);
    const inspection = await call('scene_observe', { ...base, target: 'visual', actor: 'agent_01' });
    expect(inspection).toMatchObject({ schema: 'agentscape.object-affordances', source: 'asset', physics: { registered: false } });
    expect(inspection.actions.find(action => action.action === 'setTransform')).toMatchObject({ execution: 'editor', available: true });
    expect((await call('scene_observe', { ...base, actor: 'agent_01' })).affordances.entities.find(entry => entry.id === 'visual')).toEqual(inspection);
    expect((await call('world_observe', base)).objects).toHaveLength(5);
    await call('scene_apply', { ...base, requestId: randomUUID(), operations: [{ type: 'remove', id: 'visual' }] });
    expect((await call('world_observe', base)).objects).toHaveLength(4);
    const beforeStyle = await call('scene_observe', base);
    expect((await call('scene_set_style', { ...base, style: 'builtin://toon' })).value.status).toBe('deferred');
    const styled = await call('scene_observe', base);
    expect(styled.objects).toEqual(beforeStyle.objects); expect(styled.relations).toEqual(beforeStyle.relations);
    expect(styled.style.id).toBe('builtin/toon');
    const portable = await call('scene_save', base);
    expect(portable.value.style.id).toBe('builtin/toon');
    const reopened = await openScenePackage(portable.value);
    try {
      expect(reopened.observe().objects).toHaveLength(4);
      for (const interaction of [
        { action: 'open', actor: 'agent_01', target: 'cabinet_01' },
        { action: 'pickup', actor: 'agent_01', target: 'cup_01' },
        { action: 'place', actor: 'agent_01', target: 'table_01', surfaceId: 'top' }
      ]) {
        const task = reopened.interact(interaction);
        for (let step = 0; step < 12000 && reopened.getJob(task.id).status === 'running'; step++) {
          reopened.step();
          if (step % 12 === 0) await new Promise(resolve => setTimeout(resolve, 0)); else await Promise.resolve();
        }
        expect(reopened.getJob(task.id).status).toBe('succeeded');
        expect((await reopened.waitJob(task.id)).result.verification.status).toBe('verified');
      }
    }
    finally { reopened.close(); }
    const job = await call('scene_interact', { ...base, requestId: randomUUID(), interaction: { action: 'navigate', actor: 'agent_01', position: [0, 0, 8] } });
    let observed;
    for (let poll = 0; poll < 100; poll++) {
      observed = await call('scene_job', { ...base, jobId: job.id });
      if (observed.status !== 'running') break;
      await new Promise(resolve => setTimeout(resolve, 5));
    }
    expect(observed.status).not.toBe('running');
    expect(observed.result.verification).toHaveProperty('status');
    await call('session_close', base);
  } finally {
    await client.close().catch(() => {}); await app.close();
    if (path.dirname(root) !== path.resolve(tmpdir()) || !path.basename(root).startsWith('agentscape-scene-')) throw new Error('Unexpected test directory');
    await rm(root, { recursive: true, force: true });
  }
}, 60000);
