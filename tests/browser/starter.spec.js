import { test, expect } from '@playwright/test';

test('first world: real interaction, download, reload and restore', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/starter/');
  const status = page.getByRole('status');
  await expect(status).toContainText('Ready.', { timeout: 60000 });
  await page.getByRole('button', { name: 'Pick up the cup' }).click();
  await expect(status).toContainText('Verified: the helper is holding', { timeout: 60000 });
  await page.getByRole('button', { name: 'Place it on the table' }).click();
  await expect(status).toContainText('Verified: the cup is settled', { timeout: 60000 });
  await page.locator('#asset').selectOption('chair');
  await page.getByRole('button', { name: 'Add selected object' }).click();
  await expect(status).toContainText('Added chair');
  await page.getByRole('button', { name: 'Move last added object' }).click();
  await expect(status).toContainText('Moved “chair_2”');
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download world' }).click();
  const download = await downloadPromise;
  const savedPath = await download.path();
  await page.reload();
  await expect(status).toContainText('Ready.', { timeout: 60000 });
  await page.locator('#file').setInputFiles(savedPath);
  await expect(status).toContainText('Restored 5 objects');
  await expect(page.locator('#count')).toHaveText('5 objects');
  await page.screenshot({ path: 'test-results/browser/starter-restored.png' });
  await page.locator('#file').setInputFiles({ name: 'invalid.json', mimeType: 'application/json', buffer: Buffer.from('{"schema":"unsupported"}') });
  await expect(status).toContainText('ERROR');
  await expect(page.locator('#count')).toHaveText('5 objects');
  expect(errors).toEqual([]);
});

test('starter canvas follows narrow and wide viewport after runtime startup and after restore', async ({ page }) => {
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.goto('/starter/');
  await expect(page.getByRole('status')).toContainText('Ready.', { timeout: 60000 });
  await expect(page.getByRole('navigation', { name: 'Continue with AgentScape' }).getByRole('link', { name: /Open full Studio/ })).toHaveAttribute('href', '/studio/');
  await expect(page.getByRole('navigation', { name: 'Continue with AgentScape' }).getByRole('link', { name: /Connect an AI agent with MCP/ })).toBeVisible();

  const checkViewport = async width => {
    await page.setViewportSize({ width, height: 844 });
    await expect.poll(async () => page.locator('#viewport canvas').evaluate(canvas => {
      const parentWidth = document.querySelector('#viewport').clientWidth;
      return {
        resized: canvas.clientWidth === parentWidth && Math.abs(canvas.width - Math.floor(parentWidth * Math.min(window.devicePixelRatio || 1, 2) * 0.75)) <= 1,
        documentWidth: document.documentElement.scrollWidth,
        windowWidth: window.innerWidth,
        webglLost: canvas.getContext('webgl2')?.isContextLost()
      };
    }), { timeout: 15000 }).toEqual({ resized: true, documentWidth: width, windowWidth: width, webglLost: false });
    return await page.locator('#viewport canvas').boundingBox();
  };

  const narrow = await checkViewport(390);
  expect(narrow.width).toBe(390);
  await checkViewport(1024);
  await checkViewport(320);
  await checkViewport(390);

  const downloadEvent = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download world' }).click();
  const savedPath = await (await downloadEvent).path();
  await page.locator('#file').setInputFiles(savedPath);
  await expect(page.getByRole('status')).toContainText('Restored 4 objects', { timeout: 60000 });
  await checkViewport(390);
  expect(pageErrors).toEqual([]);
});
