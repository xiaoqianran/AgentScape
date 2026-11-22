import { test, expect } from '@playwright/test';

const worlds = '/studio/?page=worlds';

test('worlds workbench is ready without constructing the 3D Runtime', async ({ page }) => {
  const errors=[];
  page.on('pageerror', error=>errors.push(error.message));
  await page.goto(worlds);
  await expect(page.locator('[data-product-page="worlds"]')).toBeVisible();
  await expect(page.locator('#runtime-status')).toHaveAttribute('data-state','ready');
  await expect(page.locator('#runtime-status')).toContainText('工作台就绪');
  const metrics=await page.evaluate(()=>window.__agentScapeStartup);
  expect(metrics.map(entry=>entry.stage)).toContain('worlds-ready');
  expect(metrics.map(entry=>entry.stage)).not.toContain('runtime-ready');
  expect(errors).toEqual([]);
});

test('opening a built-in world from the lightweight index starts the full Runtime',async({page})=>{
  const errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.goto(worlds);
  await expect(page.locator('[data-product-page="worlds"]')).toBeVisible();
  await page.locator('[data-world-card="monument-hall"] .world-card-open').click();
  await page.waitForURL(/page=world/);
  await expect(page.locator('#runtime-status')).toHaveAttribute('data-state','ready',{timeout:60000});
  expect(await page.evaluate(()=>window.__agentScapeStartup.map(entry=>entry.stage))).toContain('runtime-ready');
  expect(errors).toEqual([]);
});

test('generated world tab requests full artifact catalog without losing the tab',async({page})=>{
  const errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.goto(worlds);
  await page.getByRole('button',{name:/已生成/}).click();
  await page.waitForURL(/fullRuntime=1/);
  await expect(page.locator('#runtime-status')).toHaveAttribute('data-state','ready',{timeout:60000});
  await expect(page.getByRole('button',{name:/已生成/})).toHaveAttribute('aria-pressed','true');
  expect(errors).toEqual([]);
});

test('new draft enters full authoring Runtime only after user action',async({page})=>{
  const errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.goto(worlds);
  await expect(page.locator('#runtime-status')).toHaveAttribute('data-state','ready');
  await page.getByRole('button',{name:'新建草稿'}).first().click();
  await page.waitForURL(/authoring=new/);
  await expect(page.locator('#runtime-status')).toHaveAttribute('data-state','ready',{timeout:60000});
  expect(errors).toEqual([]);
});


test('code world entry remains accessible through the deferred runtime', async ({page})=>{
  const errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.goto(worlds);
  await page.getByRole('button',{name:'创建或打开代码世界'}).click();
  await page.waitForURL(/fullRuntime=1/);
  await expect(page.locator('#runtime-status')).toHaveAttribute('data-state','ready',{timeout:60000});
  await expect(page.locator('[data-page="world"]')).toBeVisible();
  expect(errors).toEqual([]);
});
