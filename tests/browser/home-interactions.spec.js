import { test, expect } from '@playwright/test';
import { openFiles, waitForRuntimeReady } from './fixtures.js';

test('Recent Files filters both file layouts', async ({ page }) => {
  await page.goto('/#/files');
  await page.getByRole('button', { name: 'Recent Files' }).click();
  await expect(page.getByRole('button', { name: /^Open / })).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Open Spline 3D Starter File' })).toBeVisible();

  await page.getByRole('button', { name: 'List view' }).click();
  await expect(page.getByRole('button', { name: /Spline 3D Starter File/ })).toHaveCount(1);
});

test('file actions are keyboard accessible outside the open-file button', async ({ page }) => {
  await page.goto('/#/files');
  const actions = page.getByRole('button', { name: 'More actions for Spline 3D Starter File' }).first();
  await actions.focus();
  await expect(actions).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('status')).toContainText('Actions for “Spline 3D Starter File”');
});

test('new project modal contains keyboard focus and restores it on close', async ({ page }) => {
  await page.goto('/#/files');
  const trigger = page.getByRole('button', { name: 'New Project' }).last();
  await trigger.click();
  const dialog = page.getByRole('dialog', { name: 'Create new project' });
  const input = dialog.getByLabel('Project name');
  const create = dialog.getByRole('button', { name: 'Create' });
  await expect(input).toBeFocused();

  await page.keyboard.press('Shift+Tab');
  await expect(create).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(input).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
});

test('home exposes Studio and Starter at phone width', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 });
  await page.goto('/');
  const entry = page.getByRole('region', { name: 'Get started with AgentScape' });
  const studio = entry.getByRole('link', { name: /Open Studio/ });
  const starter = entry.getByRole('link', { name: /Try Starter/ });
  await expect(studio).toBeInViewport({ ratio: 1 });
  await expect(starter).toBeInViewport({ ratio: 1 });
  await expect(studio).toHaveAttribute('href', '/studio/');
  await expect(starter).toHaveAttribute('href', '/starter/');
});

test('home creates a named Studio draft that survives reload and reopens from Worlds', async ({ page }) => {
  await page.route('http://127.0.0.1:39015/**', route => route.abort('connectionrefused'));
  await page.route('http://127.0.0.1:48123/**', route => route.abort('connectionrefused'));
  await page.goto('/');
  await page.getByRole('button', { name: 'New Project', exact: true }).first().click();
  const draftName = '草稿 & Scene #1';
  const dialog = page.getByRole('dialog', { name: 'Create new project' });
  await dialog.getByLabel('Project name').fill(draftName);
  await dialog.getByRole('button', { name: 'Create' }).click();
  await expect(page).toHaveURL(/\/studio\/\?authoring=new/);
  await waitForRuntimeReady(page);
  await openFiles(page);
  const status = page.locator('#authoring-save-status');
  await expect(status).toHaveText(draftName + ' · 尚未保存');
  await page.locator('#authoring-save').click();
  await expect(status).toHaveText(draftName + ' · 已保存');
  const savedUrl = page.url();
  const search = new URL(savedUrl).searchParams;
  expect(search.get('authoring')).toBe(await page.locator('#authoring-world-select').inputValue());
  expect(search.has('draftName')).toBe(false);

  await page.reload();
  await waitForRuntimeReady(page);
  await openFiles(page);
  await expect(status).toHaveText(draftName + ' · 已保存');

  await page.locator('[data-product-nav="worlds"]').click();
  await page.getByRole('button', { name: /我的草稿/ }).click();
  const draftRow = page.locator('.world-list-row').filter({ hasText: draftName });
  await draftRow.getByRole('button', { name: /打开|继续编辑/ }).click();
  await expect(page).toHaveURL(savedUrl);
  await openFiles(page);
  await expect(status).toHaveText(draftName + ' · 已保存');

  await page.goto('/');
  await expect(page.getByRole('button', { name: new RegExp(draftName) })).toBeVisible();
});
