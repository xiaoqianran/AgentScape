import { test, expect } from '@playwright/test';

test('trusted code runs in a Worker, renders, cancels and restores a saved asset', async ({page}) => {
    await page.goto('/examples/three-code/');
    await page.getByRole('button',{name:'Authorize and run trusted code example'}).click();
    await expect(page.getByRole('status')).toContainText('Cube created',{timeout:60000});
    const result=await page.evaluate(async()=>{
      const {AgentScape,world}=window.codeDemo;
      const container=document.querySelector('#app');
      let restored;
      try {
        const controller=new AbortController();
        const pending=world.addModel({id:'loop',asset:{kind:'three-code',source:'export function createAsset(THREE){while(true){}}'}},{signal:controller.signal});
        setTimeout(()=>controller.abort(),200);
        let cancelled=false;try{await pending;}catch(error){cancelled=error.message==='BUILD_CANCELLED';}
        const bundle=(await world.save()).value;
        world.close();
        restored=await AgentScape.open({canvas:container,bundle});
        await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
        return {cancelled,objects:restored.observe().objects.map(o=>o.id),canvas:!!container.querySelector('canvas'),assets:bundle.assets.length};
      } finally {restored?.close();world.close();container.remove();}
    });
    expect(result).toEqual({cancelled:true,objects:['cube'],canvas:true,assets:1});
});
