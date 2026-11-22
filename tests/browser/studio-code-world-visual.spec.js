import {test,expect} from '@playwright/test';

test('code-owned objects and visual additions share Studio Scene API and survive source rerun/reload',async({page})=>{
  const errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.goto('/studio/?page=world&codeWorld=eldermere-academy');
  await expect(page.locator('.studio-code-project-viewport canvas')).toBeVisible({timeout:60000});
  // A code draft must survive tab switches without being silently discarded.
  const originalSource=await page.getByLabel('世界源码').inputValue();
  await page.getByLabel('世界源码').fill(originalSource+'\n// Unsaved UI draft must survive mode switch.\n');
  await page.getByRole('button',{name:'可视化',exact:true}).click();
  await page.getByRole('button',{name:'源码',exact:true}).click();
  await expect(page.getByLabel('世界源码')).toHaveValue(/Unsaved UI draft must survive mode switch/);
  await page.getByRole('button',{name:'放弃编辑并载入最新源码'}).click();
  await page.getByRole('button',{name:'可视化',exact:true}).click();
  const visual=page.getByLabel('代码世界可视化编辑');
  const choices=visual.getByLabel('可视化对象列表');
  await expect(choices.locator('option')).toHaveCount(7);
  await choices.selectOption('grand_keep');
  await expect(visual.getByLabel('position X')).toHaveValue('0');
  await visual.getByLabel('position X').fill('6');
  await visual.getByRole('button',{name:'应用变换'}).click();
  await expect(visual.getByRole('status')).toContainText('已通过统一 Scene API',{timeout:40000});

  await visual.getByRole('button',{name:'添加方块'}).click();
  await expect(visual.getByRole('status')).toContainText('已向当前代码世界添加方块',{timeout:60000});
  const added=await choices.inputValue();
  expect(added).toMatch(/^visual_[a-f0-9]{12}$/);
  await expect(choices.locator('option')).toHaveCount(8);
  await visual.getByLabel('position X').fill('12');
  await visual.getByRole('button',{name:'应用变换'}).click();
  await expect(visual.getByRole('status')).toContainText('已通过统一 Scene API',{timeout:40000});

  await visual.getByRole('button',{name:'保存世界'}).click();
  await expect(visual.getByRole('status')).toHaveText('整个代码世界与编辑层已保存到当前浏览器',{timeout:60000});
  await page.getByRole('button',{name:'源码',exact:true}).click();
  const code=page.getByLabel('完整代码项目');

  const source=code.getByLabel('世界源码');
  const text=await source.inputValue();
  await source.fill(text+'\n// Mixed authoring: rerun preserves independent visual overrides.\n');
  await code.getByRole('button',{name:'保存源码草稿'}).click();
  await expect(code.getByRole('status')).toHaveText('源码草稿已保存',{timeout:35000});
  await code.getByRole('button',{name:'运行代码世界'}).click();
  await expect(code.getByRole('status')).toHaveText('代码世界运行中',{timeout:60000});
  await page.getByRole('button',{name:'可视化',exact:true}).click();
  await expect(visual.getByLabel('可视化对象列表').locator('option')).toHaveCount(8);
  await visual.getByLabel('可视化对象列表').selectOption('grand_keep');
  await expect(visual.getByLabel('position X')).toHaveValue('6');
  await expect(visual.getByLabel('可视化对象列表').locator('option[value="'+added+'"]')).toHaveCount(1);

  await visual.getByRole('button',{name:'保存世界'}).click();
  await expect(visual.getByRole('status')).toHaveText('整个代码世界与编辑层已保存到当前浏览器',{timeout:60000});
  await page.reload();
  await expect(page.locator('.studio-code-project-viewport canvas')).toBeVisible({timeout:60000});
  await page.getByRole('button',{name:'可视化',exact:true}).click();
  const reloaded=page.getByLabel('代码世界可视化编辑');
  await expect(reloaded.getByLabel('可视化对象列表').locator('option[value="'+added+'"]')).toHaveCount(1);
  await reloaded.getByLabel('可视化对象列表').selectOption('grand_keep');
  await expect(reloaded.getByLabel('position X')).toHaveValue('6');
  expect(errors).toEqual([]);
});
