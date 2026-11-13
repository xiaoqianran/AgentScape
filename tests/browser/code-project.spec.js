import { test, expect } from '@playwright/test';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { startServer } from '../../apps/mcp-server/main.mjs';

test('code project preserves shaders, discovers actions through real MCP and reopens its portable source and state', async ({ page }) => {
  const root = await mkdtemp(path.join(tmpdir(), 'agentscape-code-project-'));
  const token = randomBytes(32).toString('hex'), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  let app, client;
  try {
    app = await startServer({ tokens: [{ identity: 'project-owner', token }], root, port: 0,
      dataRoot: path.join(root, 'assets'), studioOrigins: ['http://127.0.0.1:4178'] });
    client = new Client({ name: 'code-project-test', version: '1' });
    await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${app.port}/mcp`), { requestInit: { headers: { Authorization: 'Bearer ' + token } } }));
    const call = async (name, args = {}) => {
      const response = await client.callTool({ name, arguments: args });
      const value = JSON.parse(response.content[0].text); expect(response.isError, JSON.stringify(value)).toBeFalsy(); return value;
    };
    await page.goto(`/examples/code-project/?mcpPort=${app.port}`);
    await page.getByRole('button', { name: '运行传送门项目' }).click();
    await expect(page.getByRole('status')).toContainText('项目已运行');
    await page.getByLabel('连接本机 MCP').check();
    await expect(page.locator('#bridge')).toHaveText('MCP connected');
    await call('session_attach');
    const observed = await call('scene_observe');
    expect(observed.project.entities.find(entity => entity.id === 'portal').actions.map(action => action.name)).toContain('teleport');
    const inspected = await call('scene_observe', { target: 'portal' });
    expect(inspected).toMatchObject({ source: 'project', physicsVerified: false });
    const job = await call('scene_interact', { requestId: randomUUID(), interaction: { action: 'custom', target: 'portal', name: 'teleport', args: { destination: 'garden' } } });
    await expect.poll(async () => (await call('scene_job', { jobId: job.id })).status).toBe('succeeded');
    expect((await call('scene_job', { jobId: job.id })).result).toMatchObject({ verification: { status: 'verified' }, value: { evidenceKind: 'project-defined', physicsVerified: false } });
    const saved = await call('scene_save');
    expect(saved.value).toMatchObject({ schema: 'agentscape.code-project', state: { zone: 'garden', uses: 1 } });
    // Reload to discard the old module, closures and scene. Restore only saved bytes.
    await page.reload();
    await page.evaluate(project => window.codeProjectDemo.open(project), saved.value);
    await expect(page.getByRole('status')).toContainText('项目已运行');
    expect(await page.evaluate(() => window.codeProjectDemo.session.scene.inspect('traveller').state.zone)).toBe('garden');
    const before = await page.evaluate(() => {
      const portal = window.codeProjectDemo.session.scene.native.scene.getObjectByName('ProjectPortal');
      return { shader: portal.material.isShaderMaterial, time: portal.material.uniforms.time.value };
    });
    expect(before.shader).toBe(true);
    await expect.poll(() => page.evaluate(() => window.codeProjectDemo.session.scene.native.scene.getObjectByName('ProjectPortal').material.uniforms.time.value)).toBeGreaterThan(before.time);
    const fresh = await page.evaluate(async () => {
      const api = window.codeProjectDemo.session.scene;
      return await api.waitJob(api.interact({ action: 'custom', target: 'portal', name: 'teleport', args: { destination: 'entrance' } }).id);
    });
    expect(fresh).toMatchObject({ status: 'succeeded', result: { verification: { status: 'verified' } } });
    await page.getByRole('button', { name: '改变光效' }).click();
    await expect(page.getByRole('status')).toContainText('未请求验证');
    expect(errors).toEqual([]);
  } finally { await client?.close().catch(() => {}); await app?.close(); await rm(root, { recursive: true, force: true }); }
});
