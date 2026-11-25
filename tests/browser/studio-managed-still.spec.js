import {test,expect,waitForRuntimeReady} from './fixtures.js';
import {readFile} from 'node:fs/promises';
import sharp from 'sharp';

test('managed-only native still excludes built-in world geometry without altering the live world',async({page})=>{
 test.setTimeout(180000);
 await page.goto('/studio/?page=world&world=monument-hall&renderer=webgl&renderScale=.5');
 await waitForRuntimeReady(page);
 await page.getByRole('button',{name:'编辑',exact:true}).click();
 const menu=page.locator('.presentation-menu');
 await menu.locator(':scope > summary').click();
 await menu.getByRole('button',{name:'从自由视角创建 / 更新'}).click();
 for(const [axis,value] of Object.entries({X:0,Y:3,Z:5}))await menu.getByLabel('相机位置 '+axis,{exact:true}).fill(String(value));
 for(const [axis,value] of Object.entries({X:0,Y:3,Z:-5}))await menu.getByLabel('相机目标 '+axis,{exact:true}).fill(String(value));
 await menu.getByRole('button',{name:'应用场景表现'}).click();
 async function capture(managed){
   await menu.getByLabel('仅托管对象').setChecked(managed);
   const pending=page.waitForEvent('download',{timeout:90000});
   await menu.getByRole('button',{name:'PNG 1920',exact:true}).click();
   const download=await pending;
   return readFile(await download.path());
 }
 const before=await capture(false),clean=await capture(true),after=await capture(false);
 for(const bytes of [before,clean,after])expect(await sharp(bytes).metadata()).toMatchObject({format:'png',width:1920,height:1080});
 const raw=async b=>sharp(b).removeAlpha().resize(160,90).raw().toBuffer();
 const [a,b,c]=await Promise.all([before,clean,after].map(raw));
 const diff=(x,y)=>x.reduce((v,n,i)=>v+Math.abs(n-y[i]),0)/x.length;
 expect(diff(a,b)).toBeGreaterThan(3);
 expect(diff(a,c)).toBeLessThan(1);
});
