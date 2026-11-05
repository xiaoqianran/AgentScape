import { test, expect, waitForRuntimeReady } from './fixtures.js';

test('mechanical workbench edits a multi-joint cabinet, compiles and publishes it to the asset library',async({page})=>{
  await page.route('**/api/capabilities',route=>route.fulfill({json:{capabilities:{agent:{available:false},'asset.compile':{available:false}}}}));
  await page.route('http://127.0.0.1:48123/**',route=>route.abort('connectionrefused'));
  await page.goto('/');
  await waitForRuntimeReady(page);
  await page.locator('[data-product-nav="assets"]').click();
  await page.locator('[data-resource-kind="create"]').click();
  const workbench=page.getByRole('region',{name:'机械资产创建工作台'});
  await expect(workbench.getByRole('heading',{name:'机械资产创建工作台'})).toBeVisible();
  await expect(page.locator('.mechanical-component-list [role="option"]')).toHaveCount(17);
  await expect(page.locator('.mechanical-preview-shell canvas')).toBeVisible();
  await page.getByLabel('资产名称').fill('验收工业机械柜');
  await page.locator('.mechanical-component-list [role=option]').filter({hasText:'LeftDoorHinge'}).click();
  await expect(page.getByLabel('关节类型')).toHaveValue('revolute');
  await expect(page.getByLabel('打开目标')).toHaveValue('-1.3');
  await page.getByRole('option',{name:/^↳ LeftDoor 长方体$/}).click();
  await page.getByLabel('几何尺寸 X').fill('0.76');
  await expect(page.locator('.mechanical-validation-ok')).toBeVisible();
  await page.getByRole('checkbox',{name:/我已检查碰撞代理/}).check();
  await page.locator('#mechanical-build').click();
  await expect(page.locator('.mechanical-result-id')).toBeVisible({timeout:120000});
  const assetId=await page.locator('.mechanical-result-id code').innerText();
  expect(assetId).toMatch(/^asset_[a-f0-9]{64}$/);
  await page.locator('[data-resource-kind="assets"]').click();
  await expect(page.locator(`[data-asset-id="${assetId}"]`)).toBeVisible();
  // Compiled assets and explicit library approval survive a browser restart.
  await page.reload();
  await waitForRuntimeReady(page);
  await page.locator('[data-product-nav="assets"]').click();
  const card=page.locator(`[data-asset-id="${assetId}"]`);
  await expect(card).toBeVisible();
  await card.getByRole('button',{name:/添加到当前世界/}).click();
  await expect(page.locator('.world-editor-workspace')).toHaveAttribute('aria-hidden','false');
  await expect(page.locator('#scene-object-list [data-object-id]')).toHaveCount(5);
});
