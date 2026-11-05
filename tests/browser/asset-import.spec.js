import {test,expect,enterWorld} from './fixtures.js';
import {compileRecipeGeometry} from '../../modules/asset/production/AssetRecipe.js';

test('reviews an unknown GLB and registers it only after parameter confirmation and real physics verification',async({page,gateway},testInfo)=>{
  const {bytes}=await compileRecipeGeometry({schema:'agentscape.asset-recipe',schemaVersion:1,id:'browser/solid_box',
    parts:[{id:'SolidBody',position:[0,.2,0],geometry:{type:'box',size:[.4,.4,.4]}}]});
  await enterWorld(page);
  await page.locator('button[aria-label="打开开发者设置"]').click();
  await page.locator('#developer-dialog summary').filter({hasText:'资产编译'}).click();
  const file={name:'unknown-solid-box.glb',mimeType:'model/gltf-binary',buffer:Buffer.from(bytes)};
  await page.locator('#compiler-file').setInputFiles(file);
  await page.locator('#prepare-interaction-button').click();
  await expect(page.locator('#interaction-review')).toBeVisible();
  await expect(page.locator('#interaction-proposal')).toContainText('均未验证、不可执行');
  const review=JSON.parse(await page.locator('#interaction-review-json').inputValue());
  expect(review.parts).toEqual([]);expect(review.physics.mass).toBeNull();
  await page.locator('#register-interaction-button').click();
  await expect(page.locator('#interaction-proposal')).toContainText('请先检查并确认物理参数');
  review.physics.mass=2;review.physics.friction=.5;
  await page.locator('#interaction-review-json').fill(JSON.stringify(review,null,2));
  await page.locator('#interaction-review-confirmed').check();
  await page.locator('#register-interaction-button').click();
  await expect(page.locator('#interaction-proposal')).toContainText('物理验证通过');
  await testInfo.attach('asset-review.png',{body:await page.locator('#developer-dialog').screenshot(),contentType:'image/png'});
  await page.locator('#compiler-file').setInputFiles(file);
  await expect(page.locator('#interaction-review')).toBeHidden();
  await expect(page.locator('#interaction-proposal')).toContainText('文件已变化');
});
