import { it, expect } from 'vitest';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { startServer } from '../../apps/mcp-server/main.mjs';
import { openScenePackage } from '../../application/scene/ScenePackage.js';

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
    const added = await call('scene_add_model', { ...base, requestId: randomUUID(), model: { id: 'visual', asset: { schema: 'agentscape.asset-recipe', schemaVersion: 1, id: 'example/visual', parts: [{ id: 'body', geometry: { type: 'box', size: [1, 1, 1] } }] } } });
    expect(added.verification.status).toBe('not-requested');
    expect((await call('scene_observe', base)).objects.find(object => object.id === 'visual').physicsRegistered).toBe(false);
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
