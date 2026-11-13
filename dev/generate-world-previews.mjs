import { mkdir, access, writeFile, rename, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { chromium } from '@playwright/test';
import sharp from 'sharp';
import { ENVIRONMENTS } from '../modules/world/content/environments.js';

const outputDir = resolve('public/previews/worlds');
const args = process.argv.slice(2);
const force = args.includes('--force');
const selected = args.filter(arg => !arg.startsWith('--'));
const baseURL = process.env.AGENTSCAPE_PREVIEW_URL || 'http://127.0.0.1:5173';
const known = new Map(ENVIRONMENTS.map(world => [world.id, world]));
const ids = selected.length ? selected : [...known.keys()];
for (const id of ids) {
  if (!known.has(id)) throw new Error(`Unknown builtin world: ${id}`);
}
await mkdir(outputDir, { recursive: true });

const browser = await chromium.launch({
  headless: true,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader']
});
let failures = 0;
try {
  for (const id of ids) {
    const output = join(outputDir, `${id}.webp`);
    if (!force) {
      try {
        await access(output);
        console.log(`SKIP ${id}: preview already exists`);
        continue;
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
    }
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    let temp;
    try {
      const url = new URL(baseURL);
      url.searchParams.set('world', id);
      url.searchParams.set('page', 'world');
      const response = await page.goto(url.href, { waitUntil: 'domcontentloaded', timeout: 30000 });
      if (!response?.ok()) throw new Error(`HTTP ${response?.status() || 'no response'}`);
      await page.locator('#runtime-status[data-state="ready"]').waitFor({ timeout: 90000 });
      const canvas = page.locator('#viewport canvas');
      await canvas.waitFor({ state: 'visible', timeout: 30000 });
      await page.waitForFunction(() => {
        const canvas = document.querySelector('#viewport canvas');
        const gl = canvas?.getContext('webgl2') || canvas?.getContext('webgl');
        return canvas?.width > 200 && canvas?.height > 200 && gl && !gl.isContextLost();
      }, null, { timeout: 30000 });
      // Allow asynchronous asset uploads, camera controls and a few render frames to settle.
      await page.waitForTimeout(1800);
      const bounds = await canvas.boundingBox();
      if (!bounds || bounds.width < 200 || bounds.height < 200) throw new Error('Viewport canvas has no usable bounds');
      // A continuously rendered 3D canvas never becomes geometrically "stable" for locator.screenshot.
      const png = await page.screenshot({ clip: bounds, timeout: 45000, animations: 'disabled' });
      const stats = await sharp(png).stats();
      const variation = Math.max(...stats.channels.slice(0, 3).map(channel => channel.stdev));
      if (variation < 4) throw new Error(`Blank or uniform canvas (stdev ${variation.toFixed(2)})`);
      if (errors.length) throw new Error(`Browser errors: ${errors.slice(0, 3).join(' | ')}`);
      temp = `${output}.tmp`;
      await sharp(png).resize(960, 540, { fit: 'cover', position: 'centre' }).webp({ quality: 82, effort: 5 }).toFile(temp);
      await rename(temp, output);
      temp = null;
      console.log(`OK   ${id}: ${output} (stdev ${variation.toFixed(1)})`);
    } catch (error) {
      failures++;
      console.error(`FAIL ${id}: ${error.message}`);
    } finally {
      if (temp) await rm(temp, { force: true }).catch(() => {});
      await context.close();
    }
  }
} finally {
  await browser.close();
}
if (failures) {
  console.error(`${failures} preview(s) failed. Existing images were preserved.`);
  process.exitCode = 1;
}
