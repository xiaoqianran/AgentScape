import { test, expect } from '@playwright/test';
import { buildCodeProject } from '../../dev/build-code-project.mjs';

test('Studio executes a normal npm Three.js project with lazy ESM and restores it',async({page})=>{
  const errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  const project=await buildCodeProject({
    entry:'examples/code-project/standard-three/main.js',
    id:'standard_three_browser',name:'Standard Three Browser'
  });
  await page.goto('/studio/?page=world');
  await expect(page.locator('#runtime-status')).toHaveAttribute('data-state','ready',{timeout:60000});
  await page.getByRole('button',{name:'代码世界',exact:true}).click();
  await page.locator('.code-project-editor input[type="file"]').first().setInputFiles({
    name:'standard-three.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(project))
  });
  await expect(page.getByLabel('项目文件列表')).toContainText('chunks/lazy-');
  await expect(page.getByRole('button',{name:'审阅后批准本版本'})).toHaveCount(0);
  await page.getByRole('button',{name:'运行代码世界',exact:true}).click();
  await expect(page.locator('.studio-code-project-viewport canvas')).toBeVisible();
  await page.getByRole('button',{name:'对象属性',exact:true}).click();
  await page.locator('.code-project-action > summary').filter({hasText:'spin'}).click();
  await page.getByRole('button',{name:'执行 spin',exact:true}).click();
  await expect(page.locator('.code-project-action output')).toHaveText('已验证');
  await expect(page.locator('.code-project-actions')).toContainText('"turns": 1');
  await page.getByRole('button',{name:'保存世界状态',exact:true}).click();
  await expect(page.locator('.code-project-editor output').first()).toHaveText('世界状态已保存到本机');
  await page.reload();
  await expect(page.locator('#runtime-status')).toHaveAttribute('data-state','ready',{timeout:60000});
  await page.getByRole('button',{name:'代码世界',exact:true}).click();
  await page.getByLabel('本机代码项目').selectOption({label:'Standard Three Browser'});
  await page.getByRole('button',{name:'打开代码项目',exact:true}).click();
  await page.getByRole('button',{name:'运行代码世界',exact:true}).click();
  await page.getByRole('button',{name:'对象属性',exact:true}).click();
  await expect(page.locator('.code-project-actions')).toContainText('"turns": 1');
  expect(errors).toEqual([]);
});
