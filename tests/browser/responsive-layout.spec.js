import { test, expect } from '@playwright/test';

for (const width of [390, 768]) {
  test(`home editors keep their panels usable at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    for (const [route, label, leftLabel] of [
      ['scene', 'Scene editor panels', 'Objects'],
      ['design', 'Design editor panels', 'Layers & agent']
    ]) {
      await page.goto(`/#/${route}`);
      const nav = page.getByRole('navigation', { name: label });
      await expect(nav).toBeVisible();
      const view = page.locator(`[data-view="${route}"]`);
      await expect.poll(async () => (await view.boundingBox()).width).toBe(width);
      await expect(nav.getByRole('button', { name: 'Canvas' })).toHaveAttribute('aria-pressed', 'true');
      await nav.getByRole('button', { name: leftLabel }).click();
      await expect(nav.getByRole('button', { name: leftLabel })).toHaveAttribute('aria-pressed', 'true');
      await expect(view.getByText(route === 'scene' ? 'Scenes' : "Let's build!")).toBeVisible();
      await nav.getByRole('button', { name: 'Inspector' }).click();
      await expect(view.getByText(route === 'scene' ? 'Global Settings' : 'Selection', { exact: true })).toBeVisible();
      await nav.getByRole('button', { name: 'Canvas' }).click();
      await expect(nav.getByRole('button', { name: 'Canvas' })).toHaveAttribute('aria-pressed', 'true');
      await nav.getByRole('button', { name: 'Back' }).click();
      await expect(page.getByRole('navigation', { name: 'Main navigation' })).toBeVisible();
    }
  });
}

test('mobile studio keeps the scene sidebar and file menu usable', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 });
  await page.route('http://127.0.0.1:39015/**', route => route.abort('connectionrefused'));
  await page.route('http://127.0.0.1:48123/**', route => route.abort('connectionrefused'));
  await page.goto('/studio/?page=world&world=monument-hall');
  await expect(page.locator('#runtime-status')).toHaveAttribute('data-state', 'ready', { timeout: 60_000 });
  const toggle = page.locator('#scene-sidebar-toggle');
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('.scene-panel')).toBeVisible();
  await toggle.click();
  const menu = page.locator('details.scene-menu');
  await menu.locator(':scope > summary').click();
  await expect(menu.locator('#save-scene')).toBeVisible();
  const box = await menu.locator('.toolbar-menu').boundingBox();
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(390);
});
