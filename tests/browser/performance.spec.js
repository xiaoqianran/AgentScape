import { test, expect } from '@playwright/test';

test('records startup, frame/CPU/heap and repeated project replacement resources', async ({ page }, info) => {
  await page.addInitScript(() => {
    const counts = { created: {}, deleted: {}, lostContexts: 0 };
    window.__resourceCounts = counts;
    const getContext = HTMLCanvasElement.prototype.getContext;
    const observed = new WeakSet();
    HTMLCanvasElement.prototype.getContext = function (...args) {
      const context = getContext.apply(this, args);
      if (context && /webgl/.test(args[0]) && !observed.has(context)) {
        observed.add(context);
        this.addEventListener('webglcontextlost', () => counts.lostContexts++);
      }
      return context;
    };
    for (const prototype of [WebGLRenderingContext.prototype, WebGL2RenderingContext.prototype]) {
      for (const kind of ['Buffer', 'Texture', 'Program', 'Shader', 'Framebuffer', 'Renderbuffer']) {
        for (const verb of ['create', 'delete']) {
          const method = verb + kind;
          if (!Object.hasOwn(prototype, method)) continue;
          const original = prototype[method];
          prototype[method] = function (...args) {
            const result = original.apply(this, args);
            if (verb === 'create' ? Boolean(result) : Boolean(args[0])) {
              const bucket = verb === 'create' ? counts.created : counts.deleted;
              bucket[kind] = (bucket[kind] || 0) + 1;
            }
            return result;
          };
        }
      }
    }
  });
  const client = await page.context().newCDPSession(page);
  await client.send('Performance.enable');
  const start = Date.now();
  await page.goto('/starter/');
  await expect(page.getByRole('status')).toContainText('Ready.', { timeout: 60000 });
  const startupMs = Date.now() - start;
  const frames = await page.evaluate(() => new Promise(resolve => {
    const samples = []; let previous;
    function sample(now) {
      if (previous !== undefined) samples.push(now - previous);
      previous = now;
      if (samples.length === 90) resolve(samples); else requestAnimationFrame(sample);
    }
    requestAnimationFrame(sample);
  }));
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: '3. Download world' }).click();
  const file = await (await downloadPromise).path();
  const replacements = [];
  for (let cycle = 0; cycle < 3; cycle++) {
    const before = Date.now();
    await page.locator('#file').setInputFiles(file);
    await expect(page.getByRole('status')).toContainText('Restored 3 objects', { timeout: 60000 });
    await expect(page.locator('#viewport canvas')).toHaveCount(1);
    await page.waitForFunction(expected => window.__resourceCounts.lostContexts >= expected, cycle + 1);
    await client.send('HeapProfiler.collectGarbage');
    const metrics = Object.fromEntries((await client.send('Performance.getMetrics')).metrics.map(x => [x.name, x.value]));
    replacements.push({ cycle, elapsedMs: Date.now() - before, jsHeapBytes: metrics.JSHeapUsedSize,
      cumulativeMainThreadTaskSeconds: metrics.TaskDuration, resources: await page.evaluate(() => window.__resourceCounts) });
  }
  const sorted = [...frames].sort((a, b) => a - b);
  const report = { backend: 'Chromium SwiftShader; GPU hardware time unavailable', platform: process.platform,
    node: process.version, startupMs, frameMs: { median: sorted[45], p95: sorted[85], max: sorted.at(-1), samples: frames.length },
    replacements, limitations: ['CDP task time is main-thread CPU, not total system CPU', 'WebGL counts are API calls, not VRAM bytes', 'No mobile or hardware GPU claim'] };
  expect(replacements.at(-1).resources.deleted.Buffer || 0).toBeGreaterThan(0);
  expect(replacements.at(-1).resources.lostContexts).toBe(3);
  await info.attach('performance-baseline.json', { body: JSON.stringify(report, null, 2), contentType: 'application/json' });
});
