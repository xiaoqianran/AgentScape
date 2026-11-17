import { test, expect } from '@playwright/test';

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
