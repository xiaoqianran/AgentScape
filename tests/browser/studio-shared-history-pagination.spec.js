import {test,expect} from '@playwright/test';
import {randomUUID} from 'node:crypto';

const token='test-browser-world-publish-token-for-isolated-e2e';
test('world history paginates beyond 12 versions and rejects stale pages after another publish',async({page})=>{
  const id='world_pagehist_'+randomUUID().replaceAll('-','');
  const endpoint='/api/studio/worlds/'+id;
  const publish=async version=>{
    const response=await page.request.put(endpoint,{
      headers:{authorization:'Bearer '+token},
      data:{kind:'code-project',baseVersion:version===1?null:version-1,
        content:{schema:'agentscape.code-project',schemaVersion:1,id,name:'分页世界',
          source:'export function createProject(){ /* Version '+version+' */ }',resources:{}}}
    });
    expect(response.status(),await response.text()).toBe(200);
  };
  for(let version=1;version<=14;version++)await publish(version);
  await page.goto('/studio/?page=worlds&collection=shared');
  const row=page.locator('[data-shared-world="'+id+'"]');
  await expect(row).toContainText('共享版本 v14',{timeout:25000});
  await row.getByRole('button',{name:'历史版本'}).click();
  const history=page.locator('[data-world-history="'+id+'"]');
  await expect(history.locator('[data-history-version]')).toHaveCount(12);
  await expect(history.getByRole('button',{name:'加载更早版本'})).toBeVisible();
  await publish(15);
  await history.getByRole('button',{name:'加载更早版本'}).click();
  await expect(history.getByRole('alert')).toContainText('共享世界已被其他浏览器更新');
  await expect(history.locator('[data-history-version]')).toHaveCount(12);
  await history.getByRole('button',{name:'刷新历史'}).click();
  await expect(history.locator('[data-history-version="15"]')).toBeVisible();
  await history.getByRole('button',{name:'加载更早版本'}).click();
  await expect(history.locator('[data-history-version]')).toHaveCount(15);
  await expect(history.locator('[data-history-version="1"]')).toBeVisible();
  await expect(history.getByRole('button',{name:'加载更早版本'})).toHaveCount(0);
});
