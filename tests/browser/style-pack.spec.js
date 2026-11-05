import { test, expect, enterWorld, verifyRenderedWorld, expectSameCanvas, openFiles } from './fixtures.js';

test('three styles preserve world identity and survive complete project export/import', async ({ page, gateway }, info) => {
  await enterWorld(page);
  const canvas = await verifyRenderedWorld(page, info);
  const ids = await page.locator('#scene-object-list [data-object-id]').evaluateAll(nodes => nodes.map(node => node.dataset.objectId));
  const timings = [];
  for (const style of ['realistic', 'toon', 'low-poly']) {
    const start = Date.now();
    await page.getByLabel('视觉风格', { exact: true }).selectOption(`builtin://${style}`);
    await page.waitForFunction(requested => {
      const control = document.querySelector('.scene-style-control select');
      const status = document.querySelector('.scene-style-control [role="status"]')?.textContent || '';
      return status.includes('失败') || (control?.value === requested && !control.disabled);
    }, `builtin://${style}`, { timeout: 60000 });
    const message = await page.locator('.scene-style-control [role="status"]').textContent();
    let detail = message;
    if (message.includes('失败')) {
      await page.locator('[data-product-nav="agent"]').click();
      await page.locator('details.activity-panel summary').click();
      detail = await page.locator('#log').textContent();
    }
    expect(message, detail).toContain('风格已应用');
    timings.push({ style, milliseconds: Date.now() - start });
    expect(await page.locator('#scene-object-list [data-object-id]').evaluateAll(nodes => nodes.map(node => node.dataset.objectId))).toEqual(ids);
    await expectSameCanvas(page, canvas);
    await verifyRenderedWorld(page, info);
  }
  await openFiles(page);
  const download = page.waitForEvent('download');
  await page.locator('#export-scene').click();
  const file = await (await download).path();
  await page.locator('#import-scene-file').setInputFiles(file);
  await expect(page.locator('#scene-file-status')).toContainText('项目已导入', { timeout: 60000 });
  await expect(page.getByLabel('视觉风格', { exact: true })).toHaveValue('builtin://low-poly', { timeout: 60000 });
  expect(await page.locator('#scene-object-list [data-object-id]').evaluateAll(nodes => nodes.map(node => node.dataset.objectId))).toEqual(ids);
  await expectSameCanvas(page, canvas);
  await info.attach('style-switch-timing.json', { body: JSON.stringify({ backend: 'Chromium software rendering', timings }), contentType: 'application/json' });
});
