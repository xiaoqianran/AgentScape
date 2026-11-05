import { test, expect } from '@playwright/test';
import { writeFile, mkdir } from 'node:fs/promises';

test('AI-agent independent first-use exploratory walkthrough', async ({ page }, info) => {
  const findings = { evaluator: 'AI agent operating Chromium through PC2 MCP', independentHuman: false, platform: 'Windows / Chromium SwiftShader', startedAt: new Date().toISOString(), steps: [], failures: [], notes: [] };
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  const step = async (name, fn) => {
    const t = Date.now();
    try { const detail = await fn(); findings.steps.push({ name, status: 'passed', elapsedMs: Date.now()-t, detail }); }
    catch (e) { findings.steps.push({ name, status: 'failed', elapsedMs: Date.now()-t, error: e.message }); findings.failures.push({ name, error: e.message }); }
  };
  const status = page.getByRole('status');
  await step('open starter from direct link and inspect initial guidance', async () => {
    await page.goto('/starter/');
    await expect(status).toContainText('Ready.', { timeout: 60000 });
    const title = await page.title();
    const buttons = await page.getByRole('button').allTextContents();
    findings.notes.push({ title, buttons, orientationText: (await page.locator('aside').innerText()).slice(0, 1200) });
    return { title, buttons, objectCount: await page.locator('#count').innerText() };
  });
  await step('pickup with actual physics verification', async () => {
    await page.getByRole('button', { name: '1. Pick up the cup' }).click();
    await expect(status).toContainText('Verified: the helper is holding', { timeout: 60000 });
    return await status.innerText();
  });
  await step('place on physical table', async () => {
    await page.getByRole('button', { name: '2. Place on the table' }).click();
    await expect(status).toContainText('Verified: the cup is settled', { timeout: 60000 });
    return await status.innerText();
  });
  await step('mistakenly move chair before adding it', async () => {
    await page.getByRole('button', { name: 'Move the chair' }).click();
    await expect(status).toContainText('Add a chair first.');
    return await status.innerText();
  });
  await step('add a chair and move it', async () => {
    await page.getByRole('button', { name: 'Add a chair' }).click();
    await expect(status).toContainText('Chair added');
    await page.getByRole('button', { name: 'Move the chair' }).click();
    await expect(status).toContainText('Chair moved');
    return await page.locator('#count').innerText();
  });
  let saved;
  await step('download project without developer console', async () => {
    const event = page.waitForEvent('download');
    await page.getByRole('button', { name: '3. Download world' }).click();
    const download = await event;
    saved = await download.path();
    return { filename: download.suggestedFilename() };
  });
  await step('reload and restore using visible Open saved world control', async () => {
    await page.reload();
    await expect(status).toContainText('Ready.', { timeout: 60000 });
    await page.getByRole('button', { name: 'Open saved world' }).click();
    await page.locator('#file').setInputFiles(saved);
    await expect(status).toContainText('Restored 4 objects', { timeout: 60000 });
    return await page.locator('#count').innerText();
  });
  await step('repeat physical pickup and place after restore', async () => {
    await page.getByRole('button', { name: '1. Pick up the cup' }).click();
    await expect(status).toContainText('Verified: the helper is holding', { timeout: 60000 });
    await page.getByRole('button', { name: '2. Place on the table' }).click();
    await expect(status).toContainText('Verified: the cup is settled', { timeout: 60000 });
    return await status.innerText();
  });
  await step('malformed file rejection retains world', async () => {
    await page.locator('#file').setInputFiles({ name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from('{broken') });
    await expect(status).toContainText('ERROR', { timeout: 15000 });
    expect(await page.locator('#count').innerText()).toBe('4 objects');
    return await status.innerText();
  });
  await step('desktop orbit and zoom through pointer/wheel', async () => {
    const viewport = page.locator('#viewport');
    const bounds = await viewport.boundingBox();
    if (!bounds) throw new Error('No world viewport');
    await page.mouse.move(bounds.x + bounds.width/2, bounds.y + bounds.height/2);
    await page.mouse.down(); await page.mouse.move(bounds.x+bounds.width/2+100, bounds.y+bounds.height/2+60, { steps: 8 }); await page.mouse.up();
    await page.mouse.wheel(0,-100);
    const canvas = viewport.locator('canvas');
    return await canvas.evaluate(el => ({ width: el.width, height: el.height, lost: el.getContext('webgl2')?.isContextLost() }));
  });
  await step('mobile-width layout initial readability check', async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    return await page.evaluate(() => ({ innerWidth, bodyScrollWidth: document.body.scrollWidth, documentScrollWidth: document.documentElement.scrollWidth, viewportBounds: document.querySelector('#viewport')?.getBoundingClientRect().toJSON() }));
  });
  findings.endedAt = new Date().toISOString();
  findings.pageErrors = errors;
  findings.totalMs = findings.steps.reduce((sum,s)=>sum+s.elapsedMs,0);
  findings.stepCount = findings.steps.length;
  findings.passed = findings.steps.filter(s=>s.status==='passed').length;
  await mkdir('.tmp-release', { recursive:true });
  await writeFile('.tmp-release/agent-first-use.json', JSON.stringify(findings,null,2));
  await info.attach('agent-first-use.json', { body: JSON.stringify(findings,null,2), contentType: 'application/json' });
  await page.screenshot({ path: info.outputPath('agent-first-use-mobile.png'), fullPage: true });
  expect(findings.failures, JSON.stringify(findings.failures)).toHaveLength(0);
  expect(errors).toEqual([]);
});
