import {test,expect} from '@playwright/test';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';

const token='test-browser-world-publish-token-for-isolated-e2e';
const original=JSON.parse(await readFile(new URL('../../public/code-projects/eldermere-academy.json',import.meta.url),'utf8'));
const makeProject=(id,version)=>({
  ...original,id,name:'历史版本验证世界 '+version,
  source:original.source+'\n// Immutable history version '+version+'\n',
  ...(version===2?{edits:{schema:'agentscape.native-edits',schemaVersion:1,
    overrides:{grand_keep:{position:[17,0,0]}}}}:{}),
  integrity:undefined
});

test('published world versions are browseable in Studio and rollback creates a new shared version',async({browser})=>{
  const id='world_history_'+randomUUID().replaceAll('-','');
  const origin=test.info().project.use.baseURL;
  const aContext=await browser.newContext({viewport:{width:1440,height:980}});
  const bContext=await browser.newContext({viewport:{width:1440,height:980}});
  const a=await aContext.newPage(),b=await bContext.newPage();
  const errors=[];
  a.on('pageerror',error=>errors.push(error.message));
  b.on('pageerror',error=>errors.push(error.message));
  const route=origin+'/api/studio/worlds/'+id;
  const publish=async(content,baseVersion)=>{
    const response=await a.request.put(route,{
      headers:{authorization:'Bearer '+token},
      data:{kind:'code-project',baseVersion,content}
    });
    expect(response.status(),await response.text()).toBe(200);
    return response.json();
  };
  try{
    expect((await publish(makeProject(id,1),null)).version).toBe(1);
    expect((await publish(makeProject(id,2),1)).version).toBe(2);
    expect((await publish(makeProject(id,3),2)).version).toBe(3);

    // A: inspect all published versions without executing untrusted source.
    await a.goto('/studio/?page=worlds&collection=shared');
    const row=a.locator('[data-shared-world="'+id+'"]');
    await expect(row).toContainText('共享版本 v3',{timeout:30000});
    await row.getByRole('button',{name:'历史版本'}).click();
    const history=a.locator('[data-world-history="'+id+'"]');
    await expect(history).toContainText(/共\s*3\s*个(?:已发布)?版本/,{timeout:25000});
    await expect(history.locator('[data-history-version]')).toHaveCount(3);
    await expect(history.locator('[data-history-version]').first()).toHaveAttribute('data-history-version','3');
    await history.getByRole('button',{name:'查看 v1 内容'}).click();
    const preview=history.getByLabel('v1 只读预览');
    await expect(preview).toContainText('Immutable history version 1',{timeout:30000});
    await expect(preview).not.toContainText('Immutable history version 3');
    await preview.getByRole('button',{name:'关闭预览'}).click();
    expect(await a.locator('.studio-code-project-viewport canvas').count()).toBe(0);

    // B: an independent browser sees the same immutable v1 and v3 before rollback.
    await b.goto('/studio/?page=worlds&collection=shared');
    const rowB=b.locator('[data-shared-world="'+id+'"]');
    await expect(rowB).toContainText('共享版本 v3',{timeout:30000});
    await rowB.getByRole('button',{name:'历史版本'}).click();
    await expect(b.locator('[data-world-history="'+id+'"] [data-history-version]')).toHaveCount(3);

    await a.getByLabel('共享世界发布授权令牌').fill(token);
    a.once('dialog',async(dialog)=>{
      expect(dialog.message()).toContain('将创建 v4');
      expect(dialog.message()).toContain('v1');
      await dialog.accept();
    });
    await history.getByRole('button',{name:'回滚到 v1'}).click();
    await expect(history.getByText('已创建共享版本 v4',{exact:false})).toBeVisible({timeout:25000});
    await expect(a.locator('[data-shared-world="'+id+'"]')).toContainText('共享版本 v4',{timeout:25000});
    await expect(history.locator('[data-history-version]')).toHaveCount(4);
    await expect(history.locator('[data-history-version="4"]')).toContainText('恢复自 v1');

    const latest=await(await b.request.get(route)).json();
    expect(latest.version).toBe(4);
    expect(latest.restoredFromVersion).toBe(1);
    expect(latest.content.source).toContain('Immutable history version 1');
    for(const version of [1,2,3]){
      const response=await b.request.get(route+'/versions/'+version);
      expect(response.status()).toBe(200);
      expect((await response.json()).content.source).toContain('Immutable history version '+version);
    }

    // Competing browser writes v5; A's cached v4 MUST NOT overwrite it.
    const newPublish=await publish(makeProject(id,5),4);
    expect(newPublish.version).toBe(5);
    a.once('dialog',dialog=>dialog.accept());
    await history.getByRole('button',{name:'回滚到 v2'}).click();
    await expect(history.getByRole('alert')).toContainText('共享世界已被其他浏览器更新',{timeout:25000});
    const latestAfter=await(await b.request.get(route)).json();
    expect(latestAfter.version).toBe(5);
    expect(latestAfter.content.source).toContain('Immutable history version 5');
    expect(errors).toEqual([]);
  }finally{await aContext.close();await bContext.close();}
});
