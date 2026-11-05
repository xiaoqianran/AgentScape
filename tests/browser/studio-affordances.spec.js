import {test,expect,enterWorld} from './fixtures.js';

test('Studio uses the same live Affordance vocabulary as Scene SDK and rejects fixed-body forces',async({page},testInfo)=>{
  await enterWorld(page);
  await page.locator('[data-object-id="table_01"]').click();
  await expect(page.locator('#inspect-subheading')).toHaveText('table_01');
  const affordances=page.locator('#actions');
  await expect(affordances).toHaveAttribute('data-affordance-source','asset');
  await expect(page.locator('#affordance-choice')).toBeVisible();
  await page.locator('#affordance-choice').selectOption('push:');
  await expect(page.locator('#execute-affordance')).toBeDisabled();
  await expect(page.locator('.affordance-reason')).toContainText('物体不是动态刚体');
  await page.locator('[data-object-id="cup_01"]').click();
  await expect(page.locator('#inspect-subheading')).toHaveText('cup_01');
  await page.locator('#affordance-choice').selectOption('push:');
  await expect(page.locator('#affordance-direction')).toBeVisible();
  await expect(page.locator('#affordance-distance')).toBeVisible();
  await page.locator('#affordance-direction').selectOption('z+');
  await page.locator('#affordance-distance').fill('0.4');
  expect(await page.locator('#viewport canvas').evaluate(canvas=>!canvas.getContext('webgl2')?.isContextLost())).toBe(true);
  await testInfo.attach('studio-affordance-panel.png',{body:await page.locator('#selection').screenshot(),contentType:'image/png'});
});
