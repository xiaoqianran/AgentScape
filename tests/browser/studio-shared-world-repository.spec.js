import {test,expect} from '@playwright/test';

const token='test-browser-world-publish-token-for-isolated-e2e';
const sharedId='world_2a1218753a07458db1cb39784010081f';

test('browser A publishes a code world with independent visual edits; browser B imports and explicitly runs it',async({browser})=>{
 const first=await browser.newContext({viewport:{width:1440,height:980}});
 const second=await browser.newContext({viewport:{width:1440,height:980}});
 const a=await first.newPage(),b=await second.newPage();
 try{
  // No silent publication and no automatic shared-source execution.
  await a.goto('/studio/?page=world&codeWorld=eldermere-academy');
  await expect(a.locator('.studio-code-project-viewport canvas')).toBeVisible({timeout:60000});
  await a.getByRole('button',{name:'可视化',exact:true}).click();
  const visual=a.getByLabel('代码世界可视化编辑');
  await visual.getByLabel('可视化对象列表').selectOption('grand_keep');
  await visual.getByLabel('position X').fill('9');
  await visual.getByRole('button',{name:'应用变换'}).click();
  await expect(visual.getByRole('status')).toContainText('已通过统一 Scene API',{timeout:35000});
  await visual.getByRole('button',{name:'添加方块'}).click();
  await expect(visual.getByRole('status')).toContainText('已向当前代码世界添加方块',{timeout:35000});
  const added=await visual.getByLabel('可视化对象列表').inputValue();
  await a.getByRole('button',{name:'源码',exact:true}).click();
  const editor=a.getByLabel('完整代码项目');
  await editor.getByLabel('共享发布授权令牌').fill(token);
  await editor.getByRole('button',{name:'发布 / 更新共享世界'}).click();
  await expect(editor.getByRole('status')).toContainText('已发布至共享 WorldRepository',{timeout:60000});

  await b.goto('/studio/?page=worlds');
  await b.getByRole('button',{name:/共享世界/}).first().click();
  const row=b.locator('[data-shared-world="'+sharedId+'"]');
  await expect(row).toContainText('Eldermere',{timeout:40000});
  await row.getByRole('button',{name:'查看源码并选择运行'}).click();
  await expect(b).toHaveURL(/sharedCode=/);
  await expect(b.getByLabel('世界源码')).toContainText('createProject',{timeout:60000});
  await expect(b.locator('.studio-code-project-viewport canvas')).toHaveCount(0);
  await b.getByLabel('完整代码项目').getByRole('button',{name:'运行代码世界'}).click();
  await expect(b.locator('.studio-code-project-viewport canvas')).toBeVisible({timeout:60000});
  await b.getByRole('button',{name:'可视化',exact:true}).click();
  const visualB=b.getByLabel('代码世界可视化编辑');
  await expect(visualB.getByLabel('可视化对象列表').locator('option[value="'+added+'"]')).toHaveCount(1);
  await visualB.getByLabel('可视化对象列表').selectOption('grand_keep');
  await expect(visualB.getByLabel('position X')).toHaveValue('9');
  expect(await second.storageState()).not.toEqual(await first.storageState());
 }finally{await a.close();await b.close();await first.close();await second.close();}
});
