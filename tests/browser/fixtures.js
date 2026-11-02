import { test as base, expect } from '@playwright/test';
import sharp from 'sharp';

// Fixed protocol data tests browser wiring, never model quality or online generation.
export const test = base.extend({
  evidence: [async ({ page }, use, testInfo) => {
    const consoleLog = [];
    const network = [];
    const pageErrors = [];
    page.on('console', message => consoleLog.push({ type: message.type(), text: message.text() }));
    page.on('pageerror', error => pageErrors.push(error.message));
    page.on('response', response => network.push({ method: response.request().method(), url: response.url(), status: response.status() }));
    page.on('requestfailed', request => network.push({ method: request.method(), url: request.url(), error: request.failure()?.errorText }));
    // Deliberately no request bodies, auth headers or credential values in evidence.
    await use({ consoleLog, network, pageErrors });
    await testInfo.attach('browser-console.json', { body: JSON.stringify({ consoleLog, pageErrors }, null, 2), contentType: 'application/json' });
    await testInfo.attach('browser-network.json', { body: JSON.stringify(network, null, 2), contentType: 'application/json' });
    await testInfo.attach('verification-scope.json', { body: JSON.stringify({ model: 'fixed-protocol-fixture', runtime: 'real-browser-world-runtime', paidServices: false }), contentType: 'application/json' });
    if (!page.isClosed()) await testInfo.attach('navigation-timing.json', { body: JSON.stringify(await page.evaluate(() => ({ navigation: performance.getEntriesByType('navigation').map(entry => entry.toJSON()), canvasCount: document.querySelectorAll('#viewport canvas').length })), null, 2), contentType: 'application/json' });
    expect(pageErrors, 'Browser must have no uncaught initialization/runtime errors').toEqual([]);
  }, { auto: true }],
  gateway: async ({ page }, use, testInfo) => {
    const requests = [];
    let handler = () => ({ message: '固定协议：观察完成。', toolCalls: [] });
    await page.route('**/api/capabilities', route => route.fulfill({ json: { capabilities: { agent: { available: true }, 'asset.compile': { available: false } } } }));
    await page.route('**/api/capabilities/agent', async route => {
      const request = route.request().postDataJSON();
      requests.push(request);
      const payload = await handler(request, requests.length);
      if (payload) await route.fulfill({ json: payload }).catch(error => {
        if (!/closed|cancelled|aborted|Invalid InterceptionId/i.test(error.message)) throw error;
      });
    });
    // Never connect to a user's paired service during ordinary browser acceptance.
    await page.route('http://127.0.0.1:48123/**', route => route.abort('connectionrefused'));
    await use({ requests, respondWith: next => { handler = next; } });
    await testInfo.attach('fixed-protocol-requests.json', { body: JSON.stringify(requests.map((request, index) => ({ round: index + 1, observedObjectIds: request.context?.world?.map(object => object.id), toolNames: request.tools?.map(tool => tool.name) })), null, 2), contentType: 'application/json' });
  }
});
export { expect };

export async function enterWorld(page) {
  const started = Date.now();
  await page.goto('/');
  await expect(page.locator('#runtime-status')).toHaveAttribute('data-state', 'ready');
  const readyMs = Date.now() - started;
  await page.locator('[data-world-card="monument-hall"] .world-card-open').click();
  await expect(page.locator('.world-editor-workspace')).toHaveAttribute('aria-hidden', 'false');
  await expect(page.locator('#scene-object-list [data-object-id="cup_01"]')).toBeVisible();
  await test.info().attach('world-startup-timing.json', { body: JSON.stringify({ readyMs, enterWorldMs: Date.now() - started, environment: 'chromium-software-rendering' }), contentType: 'application/json' });
}

export async function verifyRenderedWorld(page, testInfo) {
  const canvas = page.locator('#viewport canvas');
  await expect(canvas).toBeVisible();
  const webgl = await canvas.evaluate(element => {
    const context = element.getContext('webgl2') || element.getContext('webgl');
    return { width: element.width, height: element.height, available: Boolean(context), lost: context?.isContextLost() ?? true };
  });
  expect(webgl, 'WebGL unavailable/lost; a blank canvas is not a successful browser acceptance').toMatchObject({ available: true, lost: false });
  expect(webgl.width).toBeGreaterThan(200);
  expect(webgl.height).toBeGreaterThan(200);
  const screenshot = await canvas.screenshot({ path: testInfo.outputPath('rendered-world.png') });
  const statistics = await sharp(screenshot).stats();
  expect(Math.max(...statistics.channels.slice(0, 3).map(channel => channel.stdev)), 'Canvas is uniform/blank despite Runtime ready').toBeGreaterThan(4);
  await testInfo.attach('rendered-world.png', { body: screenshot, contentType: 'image/png' });
  return canvas.elementHandle();
}

export async function expectSameCanvas(page, original) {
  expect(await original.evaluate(element => element.isConnected && element === document.querySelector('#viewport canvas'))).toBe(true);
}

export async function openFiles(page) {
  const menu = page.locator('details.scene-menu');
  if (!await menu.evaluate(element => element.open)) await menu.locator(':scope > summary').click();
}
