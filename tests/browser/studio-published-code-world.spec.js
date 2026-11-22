import {test,expect} from '@playwright/test';

test('published MCP code world is discoverable from fresh Studio browser and survives reload',async({page})=>{
  const errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.goto('/studio/?page=worlds');
  await expect(page.locator('[aria-label="世界分类"]')).toBeVisible();
  await page.locator('[aria-label="世界分类"] button').filter({hasText:'代码世界'}).click();
  const published=page.locator('[data-code-world="eldermere-academy"]');
  await expect(published).toContainText('艾德米尔魔法学院');
  await published.getByRole('button',{name:/在 Studio 中打开/}).click();
  await expect(page).toHaveURL(/codeWorld=eldermere-academy/);
  await expect(page.locator('.studio-code-project-viewport canvas')).toBeVisible({timeout:60000});
  await expect(page.getByLabel('本机代码项目')).toContainText('Eldermere Academy');

  await page.reload();
  await expect(page.locator('.studio-code-project-viewport canvas')).toBeVisible({timeout:60000});
  await expect(page.getByLabel('本机代码项目')).toContainText('Eldermere Academy');

  await page.goto('/studio/?page=worlds');
  await page.locator('[aria-label="世界分类"] button').filter({hasText:'代码世界'}).click();
  await expect(page.locator('[data-code-world="eldermere-academy"]')).toHaveCount(1);
  expect(errors).toEqual([]);
});
