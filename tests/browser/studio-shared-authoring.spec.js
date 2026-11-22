import {test,expect} from '@playwright/test';

test('a visual authoring draft can be published and imported by a fresh browser',async({browser})=>{
 const aContext=await browser.newContext({viewport:{width:1440,height:960}});
 const bContext=await browser.newContext({viewport:{width:1440,height:960}});
 const a=await aContext.newPage(),b=await bContext.newPage();
 const pageErrors=[];
 a.on('pageerror',error=>pageErrors.push(error.message));
 b.on('pageerror',error=>pageErrors.push(error.message));
 try{
  await a.goto('/studio/?page=world&authoring=new');
  await expect(a.locator('#runtime-status')).toHaveAttribute('data-state','ready',{timeout:60000});
  // The existing file menu remains the owner of local authoring drafts.
  const menu=a.locator('details.scene-menu');
  await menu.locator(':scope > summary').click();
  const files=a.locator('#authoring-save');
  await expect(files).toBeAttached({timeout:50000});
  await expect(files).toBeEnabled();
  await files.click();
  await expect(a.locator('#authoring-save-status')).toContainText('已保存',{timeout:30000});
  const id=await a.locator('#authoring-world-select').inputValue();
  expect(id).toMatch(/^world_[a-f0-9-]+$/);

  await a.goto('/studio/?page=worlds');
  await a.locator('[aria-label="世界分类"] button').filter({hasText:'我的草稿'}).click();
  const local=a.locator('[data-world-id="'+id+'"]');
  await expect(local).toBeVisible({timeout:30000});
  await a.getByLabel('共享世界发布授权令牌').fill('test-browser-world-publish-token-for-isolated-e2e');
  await local.getByRole('button',{name:'发布共享版本'}).click();
  await expect(a.locator('.worlds-error')).toHaveCount(0);
  await a.locator('[aria-label="世界分类"] button').filter({hasText:'共享世界'}).click();
  const remote=a.locator('[data-shared-world="'+id+'"]');
  await expect(remote).toBeVisible({timeout:30000});
  await expect(remote).toContainText('创作草稿');

  await b.goto('/studio/?page=worlds');
  await b.locator('[aria-label="世界分类"] button').filter({hasText:'共享世界'}).click();
  const remoteB=b.locator('[data-shared-world="'+id+'"]');
  await expect(remoteB).toContainText('创作草稿',{timeout:30000});
  await remoteB.getByRole('button',{name:'导入并编辑'}).click();
  await expect(b).toHaveURL(/sharedDraft=/);
  await expect(b.locator('#runtime-status')).toHaveAttribute('data-state','ready',{timeout:60000});
  await expect(b.locator('#authoring-world-select')).toHaveValue(id,{timeout:30000});
  expect(pageErrors).toEqual([]);
 }finally{
  await a.close();await b.close();await aContext.close();await bContext.close();
 }
});
