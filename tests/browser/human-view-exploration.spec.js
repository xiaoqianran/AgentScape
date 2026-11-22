import { test, expect, waitForRuntimeReady } from './fixtures.js';

// "探索" must be a real in-world mode in world-first environments, not only an
// editor read-only flag. Camera movement itself is covered by the Rapier-backed
// unit tests in tests/studio/human-view-controller.test.js.
test('world-first worlds enter a human view and restore the preferred one', async ({ page }) => {
  const panel = page.locator('.human-views');
  const orbit = panel.getByRole('button', { name: '轨道', exact: true });
  const first = panel.getByRole('button', { name: '第一人称', exact: true });
  const third = panel.getByRole('button', { name: '第三人称', exact: true });

  await page.goto('/studio/?page=world&world=woodland-workshop&renderer=webgl');
  await waitForRuntimeReady(page);
  await expect(panel).toBeVisible();
  await expect(first).toHaveAttribute('aria-pressed', 'true');

  // The user's chosen person view survives an edit -> explore round trip.
  await third.click();
  await expect(third).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: '编辑', exact: true }).click();
  await expect(orbit).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: '探索', exact: true }).click();
  await expect(third).toHaveAttribute('aria-pressed', 'true');

  // Walking stays active; fixtures.js fails the test on any uncaught page error.
  await page.keyboard.down('w');
  await page.waitForTimeout(300);
  await page.keyboard.up('w');
  await expect(third).toHaveAttribute('aria-pressed', 'true');

  // A non world-first world exposes no human view and labels the mode honestly.
  await page.goto('/studio/?page=world&world=monument-hall&renderer=webgl');
  await waitForRuntimeReady(page);
  await expect(panel).toHaveCount(0);
  await expect(page.getByRole('button', { name: '只读', exact: true })).toBeVisible();
});
