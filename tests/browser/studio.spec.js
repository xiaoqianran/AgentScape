import { test, expect, enterWorld, verifyRenderedWorld, expectSameCanvas, openFiles, waitForRuntimeReady } from './fixtures.js';

test('unconfigured first visit explains unavailable agent while the world remains usable', async ({ page }, testInfo) => {
  await page.route('**/api/capabilities', route => route.fulfill({ json: { capabilities: { agent: { available: false }, 'asset.compile': { available: false } } } }));
  await page.route('http://127.0.0.1:48123/**', route => route.abort('connectionrefused'));
  await enterWorld(page);
  await verifyRenderedWorld(page, testInfo);
  await page.locator('#open-world-task').click();
  await expect(page.locator('#task-state')).toHaveAttribute('data-state', 'offline');
  await expect(page.locator('#task-state-detail')).toContainText('需要');
  await expect(page.locator('#input')).toBeDisabled();
  await expect(page.locator('#send')).toBeDisabled();
  await expect(page.locator('#viewport canvas')).toBeVisible();
});

test('first visit, object editing, undo/redo, invalid input and persistent canvas', async ({ page, gateway }, testInfo) => {
  await enterWorld(page);
  const canvas = await verifyRenderedWorld(page, testInfo);
  await page.locator('[data-object-id="cup_01"]').click();
  await expect(page.locator('#inspect-subheading')).toHaveText('cup_01');
  await page.locator('#object-scale').fill('1.25');
  await page.locator('#object-scale').press('Enter');
  await expect(page.locator('#scale')).toHaveText('1.25×');
  await page.locator('#undo').click();
  await page.locator('[data-object-id="cup_01"]').click();
  await expect(page.locator('#scale')).toHaveText('1×');
  await page.locator('#redo').click();
  await page.locator('[data-object-id="cup_01"]').click();
  await expect(page.locator('#scale')).toHaveText('1.25×');
  await page.locator('#object-scale').fill('99');
  await page.locator('#object-scale').press('Enter');
  await expect(page.locator('.inspect-error')).toContainText('0.05–20');
  await expect(page.locator('#scale')).toHaveText('1.25×');
  for (const target of ['assets', 'build', 'agent', 'worlds']) {
    await page.locator(`[data-product-nav="${target}"]`).click();
    await expectSameCanvas(page, canvas);
  }
  await page.getByRole('button', { name: '进入编辑器', exact: true }).click();
  await expect(page.locator('#viewport canvas')).toBeVisible();
  await expectSameCanvas(page, canvas);
  await verifyRenderedWorld(page, testInfo);
});

test('resource placement and saved runtime scene survive reload; corrupt import preserves project', async ({ page, gateway }, testInfo) => {
  await enterWorld(page);
  await verifyRenderedWorld(page, testInfo);
  const before = await page.locator('#scene-object-list [data-object-id]').count();
  await page.getByRole('button', { name: '添加资源', exact: true }).click();
  await page.locator('[data-asset-id="cup"] button[title="放到视口中心"]').click();
  await page.getByRole('button', { name: '场景对象', exact: true }).click();
  await expect(page.locator('#scene-object-list [data-object-id]')).toHaveCount(before + 1);
  const added = await page.locator('#scene-object-list [data-object-id][aria-pressed="true"]').getAttribute('data-object-id');
  expect(added).toBeTruthy();
  await openFiles(page);
  await page.locator('#save-scene').click();
  await page.reload();
  await waitForRuntimeReady(page);
  await openFiles(page);
  await page.locator('#load-scene').click();
  await expect(page.locator(`#scene-object-list [data-object-id="${added}"]`)).toBeVisible();
  const objects = await page.locator('#scene-object-list [data-object-id]').evaluateAll(elements => elements.map(element => element.dataset.objectId));
  await openFiles(page);
  await page.locator('#import-scene-file').setInputFiles({ name: 'corrupt-scene.json', mimeType: 'application/json', buffer: Buffer.from('{"schema":"unsupported"}') });
  await expect(page.locator('#scene-object-list [data-object-id]')).toHaveCount(objects.length);
  expect(await page.locator('#scene-object-list [data-object-id]').evaluateAll(elements => elements.map(element => element.dataset.objectId))).toEqual(objects);
  await page.locator('[data-product-nav="agent"]').click();
  await page.locator('details.activity-panel summary').click();
  await expect(page.locator('#log')).toContainText('导入错误');
});

test('authoring draft can save, reload and reopen from the user file menu', async ({ page, gateway }, testInfo) => {
  await enterWorld(page);
  await openFiles(page);
  await page.locator('#authoring-new').click();
  await expect(page.locator('#authoring-save-status')).toContainText('尚未保存');
  await page.locator('#authoring-save').click();
  await expect(page.locator('#authoring-save-status')).toContainText('已保存');
  const id = await page.locator('#authoring-world-select').inputValue();
  expect(id).toBeTruthy();
  await page.reload();
  await waitForRuntimeReady(page);
  await openFiles(page);
  await page.locator('#authoring-world-select').selectOption(id);
  await page.locator('#authoring-open').click();
  await expect(page.locator('#authoring-save-status')).toContainText('已保存');
  await expect(page.locator('#authoring-world-select')).toHaveValue(id);
  await verifyRenderedWorld(page, testInfo);
});

test('fixed protocol task starts, cancels its pending model request and retries from a fresh observation', async ({ page, gateway }, testInfo) => {
  let release;
  const blocked = new Promise(resolve => { release = resolve; });
  gateway.respondWith(async () => {
    await blocked;
    return { message: '', toolCalls: [{ id: 'must-not-execute-after-cancel', name: 'removeObject', args: { id: 'cup_01' } }] };
  });
  await enterWorld(page);
  const canvas = await verifyRenderedWorld(page, testInfo);
  const objects = await page.locator('#scene-object-list [data-object-id]').count();
  await page.locator('[data-object-id="cup_01"]').click();
  await page.locator('#open-world-task').click();
  await page.locator('#input').fill('固定协议验收：观察世界后等待取消');
  await page.locator('#send').click();
  await expect.poll(() => gateway.requests.length).toBe(1);
  expect(gateway.requests[0].messages.findLast(message => message.role === 'user').content).toContain('"id":"cup_01"');
  await expect(page.locator('#viewport canvas')).toBeVisible();
  await expectSameCanvas(page, canvas);
  await page.locator('#cancel-task').click();
  release();
  await expect(page.locator('#task-state')).toHaveAttribute('data-state', 'cancelled');
  await expect(page.locator('#scene-object-list [data-object-id]')).toHaveCount(objects);
  await expect(page.locator('[data-object-id="cup_01"]')).toBeVisible();
  expect(gateway.requests).toHaveLength(1);
  gateway.respondWith(() => ({ message: '固定协议：已重新观察当前世界，无修改。', toolCalls: [] }));
  await page.locator('#retry-task').click();
  await expect.poll(() => gateway.requests.length).toBe(2);
  expect(gateway.requests[1].context.world.some(object => object.id === 'cup_01')).toBe(true);
  await expect(page.locator('#task-state')).not.toHaveAttribute('data-state', 'running');
  await expectSameCanvas(page, canvas);
});
