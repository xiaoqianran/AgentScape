import {test,expect} from '@playwright/test';

const studio='/studio/?page=world';
const dark='rgb(16, 17, 19)';

test('Studio first paint is dark even before React and JavaScript load',async({browser})=>{
  const context=await browser.newContext({javaScriptEnabled:false});
  try {
    const page=await context.newPage();
    await page.goto(studio);
    const state=await page.evaluate(()=>({
      html:getComputedStyle(document.documentElement).backgroundColor,
      body:getComputedStyle(document.body).backgroundColor,
      app:getComputedStyle(document.querySelector('#app')).backgroundColor,
      scheme:getComputedStyle(document.documentElement).colorScheme,
      mounted:Boolean(document.querySelector('.shell'))
    }));
    expect(state).toMatchObject({html:dark,body:dark,app:dark,scheme:'dark',mounted:false});
  } finally {await context.close();}
});

test('Studio retains dark background across entry, reload and runtime startup',async({page})=>{
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  for(let i=0;i<2;i++){
    await page.goto(studio,{waitUntil:'domcontentloaded'});
    await expect(page.locator('html')).toHaveCSS('background-color',dark);
    await expect(page.locator('body')).toHaveCSS('background-color',dark);
    await expect(page.locator('#app')).toHaveCSS('background-color',dark);
    await expect(page.locator('#runtime-status')).toHaveAttribute('data-state','ready',{timeout:60000});
    await expect(page.locator('html')).toHaveCSS('background-color',dark);
  }
  expect(errors).toEqual([]);
});
