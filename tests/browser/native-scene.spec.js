import { test, expect } from '@playwright/test';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { startServer } from '../../apps/mcp-server/main.mjs';

test('unchanged native project keeps its shader, instances and loop across injection and detach', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/examples/native-scene/');
  await expect(page.getByRole('button', { name: '连接场景', exact: true })).toBeEnabled();
  await page.evaluate(() => {
    const candidate = window.nativeDemo.listNativeScenes()[0];
    const ring = candidate.scene.getObjectByName('NativeShader');
    window.nativeBefore = { candidate, ring, material: ring.material, callback: ring.onBeforeRender,
      exposure: candidate.renderer.toneMappingExposure, canvas: candidate.renderer.domElement };
  });
  await page.getByRole('button', { name: '连接场景', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('已连接');
  await page.getByRole('button', { name: '注入柜子、杯子和 Agent' }).click();
  await expect(page.getByRole('status')).toContainText('已注入 3 个资产', { timeout: 60000 });
  await expect.poll(() => page.evaluate(() => window.nativeDemo.session.world.physics.getPosition('native_cup')[1])).toBeLessThan(.5);
  expect(await page.evaluate(() => {
    const { candidate, ring, material, callback, exposure, canvas } = window.nativeBefore;
    const host = window.nativeDemo.session;
    return {
      mounted: host.world.scene.parent === candidate.scene,
      material: ring.material === material, callback: ring.onBeforeRender === callback,
      instances: candidate.scene.getObjectByName('NativeColumns').count,
      sameCanvas: candidate.renderer.domElement === canvas,
      exposure: candidate.renderer.toneMappingExposure === exposure,
      calls: ring.userData.renderCalls > 1,
      physics: host.scene.observe().objects.every(o => o.physicsRegistered),
    };
  })).toEqual({ mounted: true, material: true, callback: true, instances: 12, sameCanvas: true, exposure: true, calls: true, physics: true });
  await page.getByRole('button', { name: '移除注入层' }).click();
  await expect(page.getByRole('status')).toContainText('原生场景继续运行');
  const calls = await page.evaluate(() => window.nativeBefore.ring.userData.renderCalls);
  await expect.poll(() => page.evaluate(() => window.nativeBefore.ring.userData.renderCalls)).toBeGreaterThan(calls);
  expect(await page.evaluate(() => !!window.nativeBefore.candidate.scene.getObjectByName('AgentScapeRoot'))).toBe(false);
  expect(errors).toEqual([]);
});

test('real MCP HTTP injects into the native browser scene and disconnects when detached', async ({ page }) => {
  const root = await mkdtemp(path.join(tmpdir(), 'agentscape-native-mcp-'));
  const token = randomBytes(32).toString('hex');
  let app, client;
  try {
    app = await startServer({ tokens: [{ identity: 'native-owner', token }], root, port: 0,
      dataRoot: path.join(root, 'assets'), studioOrigins: ['http://127.0.0.1:4178'] });
    client = new Client({ name: 'native-scene-test', version: '1' });
    await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${app.port}/mcp`),
      { requestInit: { headers: { Authorization: 'Bearer ' + token } } }));
    const call = async (name, args = {}) => {
      const response = await client.callTool({ name, arguments: args });
      return { isError: !!response.isError, ...JSON.parse(response.content[0].text) };
    };
    await page.goto(`/examples/native-scene/?mcpPort=${app.port}`);
    await page.getByRole('button', { name: '连接场景', exact: true }).click();
    await expect(page.getByRole('status')).toContainText('已连接');
    await page.getByLabel('连接本机 MCP').check();
    await expect(page.locator('#bridge-status')).toContainText('MCP 已连接');
    const attached = await call('session_attach');
    expect(attached.worldId).toBe('native-scene');
    const added = await call('scene_add_model', { requestId: randomUUID(),
      model: { id: 'mcp_native_cup', asset: 'builtin://cup', position: [2, 2, 0] } });
    expect(added.isError, JSON.stringify(added)).toBe(false);
    expect((await call('scene_observe')).objects.map(o => o.id)).toEqual(['mcp_native_cup']);
    expect(await page.evaluate(() => {
      const host = window.nativeDemo.session;
      const object = host.world.store.get('mcp_native_cup').object;
      return host.scene.native.scene.getObjectByProperty('uuid', object.uuid) === object;
    })).toBe(true);
    await expect.poll(() => page.evaluate(() => window.nativeDemo.session.world.physics.getPosition('mcp_native_cup')[1])).toBeLessThan(.5);
    expect((await call('scene_add_model', { requestId: randomUUID(),
      model: { id: 'mcp_native_agent', asset: 'builtin://agent', position: [0, 0, 2] } })).isError).toBe(false);
    const job = await call('scene_interact', { requestId: randomUUID(),
      interaction: { actor: 'mcp_native_agent', action: 'navigate', position: [3, 0, 3] } });
    expect(job.isError, JSON.stringify(job)).toBe(false);
    await expect.poll(async () => (await call('scene_job', { jobId: job.id })).status, { timeout: 30000 }).not.toBe('running');
    const completed = await call('scene_job', { jobId: job.id });
    expect(completed.status, JSON.stringify(completed)).toBe('succeeded');
    expect(completed.result.verification.status).toBe('verified');
    const save = await call('scene_save');
    expect(save.isError).toBe(true);
    await page.getByRole('button', { name: '移除注入层' }).click();
    await expect.poll(async () => (await call('scene_observe', { worldSessionId: attached.worldSessionId })).isError).toBe(true);
  } finally {
    await client?.close().catch(() => {});
    await app?.close();
    await rm(root, { recursive: true, force: true });
  }
});

test('native overlay survives detach and reattach without replacing host-owned objects', async ({ page }) => {
  await page.goto('/examples/native-scene/');
  await page.getByRole('button', { name: '连接场景', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('已连接');
  await page.getByRole('button', { name: '注入柜子、杯子和 Agent' }).click();
  await expect(page.getByRole('status')).toContainText('已注入 3 个资产', { timeout: 60000 });
  const root = await page.evaluate(async () => {
    const saved = await window.nativeDemo.session.scene.saveOverlay(window.nativeDemo.storage);
    await window.nativeDemo.session.scene.addModel({
      id: 'temporary_overlay_object', asset: 'builtin://chair', position: [0, 0, 0]
    });
    return saved;
  });
  expect(root.kind).toBe('native-overlay');
  await page.getByRole('button', { name: '移除注入层' }).click();
  await expect(page.getByRole('status')).toContainText('原生场景继续运行');
  await page.getByRole('button', { name: '连接场景', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('已连接');
  const restored = await page.evaluate(async root => {
    const session = window.nativeDemo.session;
    await session.scene.restoreOverlay(window.nativeDemo.storage, root);
    return {
      ids: session.scene.observe().objects.map(object => object.id).sort(),
      hostFloor: session.scene.native.scene.getObjectByName('NativeFloor') != null,
      rendererOwned: session.scene.capabilities.ownsRenderer,
    };
  }, root);
  expect(restored).toEqual({
    ids: ['native_agent', 'native_cabinet', 'native_cup'],
    hostFloor: true,
    rendererOwned: false,
  });
  await page.getByRole('button', { name: '移除注入层' }).click();
});
test('published native overlay survives browser reload and restores automatically from OPFS and IndexedDB', async ({ page }) => {
  await page.goto('/examples/native-scene/');
  await page.getByRole('button', { name: '连接场景', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('已连接');
  await page.getByRole('button', { name: '注入柜子、杯子和 Agent' }).click();
  await expect(page.getByRole('status')).toContainText('已注入 3 个资产', { timeout: 60000 });
  const savedRoot = await page.evaluate(() => window.nativeDemo.checkpoint.saveLatest());
  expect(savedRoot.kind).toBe('native-overlay');
  const stalePublishRejected = await page.evaluate(async () => {
    try {
      const root = await window.nativeDemo.checkpoint.readLatest();
      await window.nativeDemo.heads.publish(null, root);
      return false;
    } catch (error) { return error.code === 'NATIVE_OVERLAY_HEAD_CONFLICT'; }
  });
  expect(stalePublishRejected).toBe(true);
  await page.reload();
  await page.getByRole('button', { name: '连接场景', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('已连接');
  const restored = await page.evaluate(async () => ({
    root: await window.nativeDemo.checkpoint.readLatest(),
    ids: window.nativeDemo.session.scene.observe().objects.map(o => o.id).sort(),
    floor: !!window.nativeDemo.session.scene.native.scene.getObjectByName('NativeFloor')
  }));
  expect(restored).toEqual({
    root: savedRoot,
    ids: ['native_agent', 'native_cabinet', 'native_cup'],
    floor: true
  });
  await page.getByRole('button', { name: '移除注入层' }).click();
});
test('guided native onboarding saves, reloads and manually restores assets with visible feedback', async ({page}) => {
  await page.goto('/examples/native-scene/');
  await expect(page.getByRole('button',{name:'保存注入层'})).toBeDisabled();
  await expect(page.getByRole('button',{name:'恢复最近存档'})).toBeDisabled();
  await expect(page.getByText('首次使用 · 四步完成')).toBeVisible();
  await page.getByRole('button',{name:'连接场景',exact:true}).click();
  await expect(page.getByRole('status')).toContainText('已连接');
  await expect(page.locator('#overlay-status')).toContainText('尚无已发布存档');
  await page.getByRole('button',{name:'注入柜子、杯子和 Agent'}).click();
  await expect(page.getByRole('status')).toContainText('已注入 3 个资产',{timeout:60000});
  await expect(page.locator('#overlay-status')).toContainText('新增对象尚未保存');
  await page.getByRole('button',{name:'保存注入层'}).click();
  await expect(page.locator('#overlay-status')).toContainText('已保存注入层',{timeout:30000});
  await expect(page.getByRole('button',{name:'恢复最近存档'})).toBeEnabled();
  await page.evaluate(()=>window.nativeDemo.session.scene.addModel({
    id:'unsaved_added_chair',asset:'builtin://chair',position:[0,0,0]
  }));
  await page.getByRole('button',{name:'恢复最近存档'}).click();
  await expect(page.locator('#overlay-status')).toContainText('已恢复最近存档',{timeout:30000});
  expect(await page.evaluate(()=>window.nativeDemo.session.scene.observe().objects.map(o=>o.id).sort()))
    .toEqual(['native_agent','native_cabinet','native_cup']);
  await page.reload();
  await page.getByRole('button',{name:'连接场景',exact:true}).click();
  await expect(page.getByRole('status')).toContainText('已连接');
  await expect(page.getByRole('button',{name:'恢复最近存档'})).toBeEnabled();
  expect(await page.evaluate(()=>window.nativeDemo.session.scene.observe().objects.map(o=>o.id).sort()))
    .toEqual(['native_agent','native_cabinet','native_cup']);
  await page.getByRole('button',{name:'移除注入层'}).click();
  await expect(page.getByRole('button',{name:'保存注入层'})).toBeDisabled();
});

test('guided native restore failure remains visible and preserves the current world',async({page})=>{
  await page.goto('/examples/native-scene/');
  await page.getByRole('button',{name:'连接场景',exact:true}).click();
  await page.getByRole('button',{name:'注入柜子、杯子和 Agent'}).click();
  await expect(page.getByRole('status')).toContainText('已注入 3 个资产',{timeout:60000});
  await page.getByRole('button',{name:'保存注入层'}).click();
  await expect(page.locator('#overlay-status')).toContainText('已保存注入层');
  await page.evaluate(()=>{
    window.nativeDemo.checkpoint.restoreLatest=async()=>{
      throw Object.assign(new Error('TEST_RESTORE_FAILURE'),{code:'TEST_RESTORE_FAILURE'});
    };
  });
  await page.getByRole('button',{name:'恢复最近存档'}).click();
  await expect(page.locator('#overlay-status')).toContainText('恢复失败：TEST_RESTORE_FAILURE');
  expect(await page.evaluate(()=>window.nativeDemo.session.scene.observe().objects.length)).toBe(3);
  await expect(page.getByRole('button',{name:'保存注入层'})).toBeEnabled();
});
