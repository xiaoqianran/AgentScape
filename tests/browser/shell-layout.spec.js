import { test, expect } from '@playwright/test';

for (const width of [320, 390, 768, 1440]) {
  test(`shell pages are centered and fit at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    for (const route of ['home', 'files', 'templates', 'community', 'academy']) {
      await page.goto(`/#/${route}`);
      const content = page.locator('[data-shell-content]');
      await expect(content).toBeVisible();
      const geometry = await content.evaluate(element => {
        const parent = element.parentElement.getBoundingClientRect();
        const box = element.getBoundingClientRect();
        return { offset: (box.left + box.right - parent.left - parent.right) / 2,
          overflow: element.scrollWidth - element.clientWidth };
      });
      expect(Math.abs(geometry.offset), route).toBeLessThan(1);
      expect(geometry.overflow, route).toBeLessThanOrEqual(1);
      const actions = page.getByRole('group', { name: 'Create' });
      const bounds = await actions.boundingBox();
      expect(bounds.x + bounds.width, route).toBeLessThanOrEqual(width);
    }
    await page.goto('/#/home');
    const center = await page.getByRole('heading', { name: /Welcome back/ }).evaluate(element => {
      const column = element.parentElement.getBoundingClientRect();
      const container = element.closest('[data-shell-content]').getBoundingClientRect();
      return (column.left + column.right - container.left - container.right) / 2;
    });
    expect(Math.abs(center)).toBeLessThan(1);
  });
}
