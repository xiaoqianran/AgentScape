import {test,expect,waitForRuntimeReady} from './fixtures.js';

test('Asset Forge P1 imports multi-material hinges and plots real runtime temperature/energy',async({page},testInfo)=>{
  await page.route('**/api/capabilities',route=>route.fulfill({json:{
    capabilities:{agent:{available:false},'asset.compile':{available:false}}
  }}));
  await page.route('http://127.0.0.1:48123/**',route=>route.abort('connectionrefused'));
  await page.goto('/?world=monument-hall');
  await waitForRuntimeReady(page);
  await page.locator('[data-product-nav="assets"]').click();
  await page.locator('[data-resource-kind="create"]').click();
  const editor=page.getByRole('region',{name:'科学材料与热学锻造'});
  await expect(editor).toBeVisible();
  await page.locator('.mechanical-workbench input[type="file"]').setInputFiles(
    'examples/asset-forge/thermal-hinged-door.json'
  );
  await expect(editor.getByRole('button',{name:/已启用多部件热学网络/})).toBeVisible();
  await expect(editor.getByLabel('编辑热学部件')).toBeVisible();
  await editor.getByLabel('编辑热学部件').selectOption('door');
  await expect(editor.getByLabel('door · 材料名称')).toHaveValue('声明木质门板');
  await expect(editor.getByLabel('内部导热 door')).toHaveValue('8');
  await page.getByRole('checkbox',{name:/我已检查碰撞代理/}).check();
  await page.locator('#mechanical-build').click();
  await expect(page.locator('.mechanical-result-id')).toBeVisible({timeout:120000});

  await page.getByRole('button',{name:'放入当前世界'}).click();
  await expect(page.locator('.world-editor-workspace')).toHaveAttribute('aria-hidden','false',{timeout:30000});
  await page.locator('[data-product-nav="assets"]').click();
  await page.locator('[data-resource-kind="lab"]').click();
  const lab=page.getByRole('region',{name:'Asset Forge 热学实验台'});
  await expect(lab).toBeVisible();
  await expect(lab.locator('.thermal-lab-targets label')).toHaveCount(1);
  await expect(lab.getByLabel('加热部件')).toContainText('door');
  await expect(lab.getByRole('heading',{name:'温度变化'})).toBeVisible();
  await lab.getByLabel('加热部件').selectOption('door');
  await lab.getByLabel('实验热功率').fill('900');
  await lab.getByRole('button',{name:'设置功率'}).click();
  await lab.getByLabel('实验推进时间').fill('2');
  await lab.getByRole('button',{name:'推进世界实验'}).click();
  await expect(lab.locator('svg polyline').first()).toBeVisible({timeout:30000});
  await expect(lab.getByRole('heading',{name:'显热能量变化'})).toBeVisible();
  await testInfo.attach('asset-forge-thermal-lab.png',{
    body:await lab.screenshot(),contentType:'image/png'
  });
});
