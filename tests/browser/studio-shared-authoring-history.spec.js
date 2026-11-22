import {test,expect} from '@playwright/test';
import {randomUUID} from 'node:crypto';

const token='test-browser-world-publish-token-for-isolated-e2e';
const makeDraft=(id,marker)=>({
  id,name:'历史创作草稿 '+marker,
  document:{format:'agentscape-world-authoring',version:1,root:{
    id:'root',children:[{id:'node_'+marker,children:[]}]
  }},promotions:null
});

test('a historical authoring document can be previewed, rolled back, and reopened in a fresh browser',async({browser})=>{
  const id='world_history_draft_'+randomUUID().replaceAll('-','');
  const origin=test.info().project.use.baseURL,url=origin+'/api/studio/worlds/'+id;
  const aContext=await browser.newContext(),bContext=await browser.newContext();
  const a=await aContext.newPage(),b=await bContext.newPage();
  const publish=async(marker,baseVersion)=>{
    const response=await a.request.put(url,{
      headers:{authorization:'Bearer '+token},
      data:{kind:'authoring-draft',baseVersion,content:makeDraft(id,marker)}
    });
    expect(response.status(),await response.text()).toBe(200);
  };
  try{
    await publish('old_tree',null);
    await publish('second_lantern',1);
    await publish('third_tower',2);
    await a.goto('/studio/?page=worlds&collection=shared');
    const row=a.locator('[data-shared-world="'+id+'"]');
    await expect(row).toContainText('共享版本 v3',{timeout:30000});
    await row.getByRole('button',{name:'历史版本'}).click();
    const history=a.locator('[data-world-history="'+id+'"]');
    await expect(history.locator('[data-history-version]')).toHaveCount(3);
    await history.getByRole('button',{name:'查看 v1 内容'}).click();
    await expect(history.getByLabel('v1 只读预览')).toContainText('node_old_tree');
    await history.getByLabel('v1 只读预览').getByRole('button',{name:'关闭预览'}).click();
    await a.getByLabel('共享世界发布授权令牌').fill(token);
    a.once('dialog',dialog=>dialog.accept());
    await history.getByRole('button',{name:'回滚到 v1'}).click();
    await expect(history.getByRole('status')).toContainText('已创建共享版本 v4',{timeout:30000});
    const restored=await(await a.request.get(url)).json();
    expect(restored).toMatchObject({version:4,restoredFromVersion:1});
    expect(restored.content.document.root.children[0].id).toBe('node_old_tree');
    expect((await(await a.request.get(url+'/versions/3')).json()).content.document.root.children[0].id).toBe('node_third_tower');
    expect((await(await a.request.get(url+'/versions/2')).json()).content.document.root.children[0].id).toBe('node_second_lantern');

    await b.goto('/studio/?page=worlds&collection=shared');
    const sharedB=b.locator('[data-shared-world="'+id+'"]');
    await expect(sharedB).toContainText('共享版本 v4',{timeout:30000});
    await sharedB.getByRole('button',{name:'导入并编辑'}).click();
    await expect(b.locator('#runtime-status')).toHaveAttribute('data-state','ready',{timeout:60000});
    await expect(b.locator('#authoring-world-select')).toHaveValue(id,{timeout:30000});
    const saved=await b.evaluate(async worldId=>{
      const db=await new Promise((resolve,reject)=>{
        const req=indexedDB.open('agentscape-world-authoring');
        req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);
      });
      return await new Promise((resolve,reject)=>{
        const tx=db.transaction('worlds','readonly');
        const req=tx.objectStore('worlds').get(worldId);
        req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);
      });
    },id);
    expect(saved.document.root.children[0].id).toBe('node_old_tree');
  }finally{
    await aContext.close();await bContext.close();
  }
});
