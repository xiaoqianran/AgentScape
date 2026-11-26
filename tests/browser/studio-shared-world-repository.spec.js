import {test,expect} from '@playwright/test';

const token='test-browser-world-publish-token-for-isolated-e2e';
const sharedId='world_2a1218753a07458db1cb39784010081f';

test('browser A publishes a code world with independent visual edits; browser B imports and explicitly runs it',async({browser})=>{
 test.setTimeout(300000);
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
  await editor.locator('summary').filter({hasText:'共享世界发布'}).click();
  await editor.getByLabel('共享发布授权令牌').fill(token);
  await editor.getByRole('button',{name:'发布 / 更新共享世界'}).click();
  // Assert on the repository head itself, not only on the UI message: the
  // publish chain (save + persist + PUT + refresh) is the slowest step of
  // this test and the status text is only set after it returns. The shared
  // record existing server-side is the authoritative completion signal;
  // the status text must then follow immediately.
  await expect.poll(async()=>{
    const response=await a.request.get(new URL('/api/studio/worlds/'+sharedId,a.url()).href);
    if(!response.ok())return 0;
    const record=await response.json();
    return Number.isSafeInteger(record.version)?record.version:0;
  },{timeout:120000}).toBeGreaterThanOrEqual(1);
  await expect(editor.getByRole('status')).toContainText('已发布至共享 WorldRepository',{timeout:30000});

  await b.goto('/studio/?page=worlds');
  await b.getByRole('button',{name:/共享世界/}).first().click();
  const row=b.locator('[data-shared-world="'+sharedId+'"]');
  await expect(row).toContainText('Eldermere',{timeout:40000});
  await row.getByRole('button',{name:'查看源码并选择运行'}).click();
  await expect(b).toHaveURL(/sharedCode=/);
  await expect(b.getByLabel('世界源码')).toContainText('createProject',{timeout:120000});
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
