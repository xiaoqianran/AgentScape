import { test, expect, enterWorld, openFiles, waitForRuntimeReady } from './fixtures.js';

test('Studio exports and imports a content-addressed world file, rejecting corruption without replacing the current scene', async ({page}) => {
  await page.addInitScript(() => {
    globalThis.__worldArchiveChunks=[];
    Object.defineProperty(globalThis,'showSaveFilePicker',{ configurable:true,value:async()=>({
      createWritable:async()=>({
        write:async bytes=>{globalThis.__worldArchiveChunks.push(Array.from(bytes));},
        close:async()=>{}, abort:async()=>{}
      })
    })});
  });
  await enterWorld(page);
  await page.getByRole('button',{name:'编辑',exact:true}).click();
  await openFiles(page);
  await page.locator('#export-world-package').click();
  await expect(page.locator('#scene-file-status')).toContainText('世界包已导出',{timeout:60000});
  const parts=await page.evaluate(()=>globalThis.__worldArchiveChunks);
  const bytes=Buffer.from(parts.flat());
  expect(bytes.subarray(0,8).toString()).toBe('ASWORLD1');
  const initial=await page.locator('#scene-object-list [data-object-id]').count();
  await page.locator('#import-world-package-file').setInputFiles({name:'invalid.asworld',mimeType:'application/octet-stream',buffer:Buffer.from('invalid')});
  await expect(page.locator('#scene-file-status')).toContainText('导入失败',{timeout:30000});
  await expect(page.locator('#scene-object-list [data-object-id]')).toHaveCount(initial);
  await page.locator('#import-world-package-file').setInputFiles({name:'valid.asworld',mimeType:'application/octet-stream',buffer:bytes});
  await expect(page.locator('#scene-file-status')).toContainText('世界包已导入',{timeout:60000});
  await expect(page.locator('#scene-object-list [data-object-id]')).toHaveCount(initial);
});
