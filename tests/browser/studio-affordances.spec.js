import {test,expect,enterWorld} from './fixtures.js';

test('Studio uses the same live Affordance vocabulary as Scene SDK and rejects fixed-body forces',async({page},testInfo)=>{
  await enterWorld(page);
  await page.locator('[data-object-id="table_01"]').click();
  await expect(page.locator('#affordance-choice')).toHaveCount(0);
  await page.locator('.selection-action-dock').getByRole('button',{name:'属性',exact:true}).click();
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

test('multiple Agents require an explicit shared choice in inspector and task planning',async({page,gateway})=>{
  await enterWorld(page);
  await page.getByRole('button',{name:'添加资源',exact:true}).click();
  await page.locator('[data-asset-id="agent"] button[title="放到视口中心"]').click();
  await page.getByRole('button',{name:'场景对象',exact:true}).click();
  await page.locator('[data-object-id="cup_01"]').click();
  await page.locator('.selection-action-dock').getByRole('button',{name:'属性',exact:true}).click();
  const actor=page.locator('#affordance-actor');
  await expect(actor).toHaveValue('');
  await expect(page.locator('#execute-affordance')).toBeDisabled();
  const second=await actor.locator('option').evaluateAll(options=>options.map(option=>option.value).find(value=>value && value!=='agent_01'));
  expect(second).toBeTruthy();
  await actor.selectOption(second);
  await page.locator('#open-world-task').click();
  await expect(page.locator('#task-actor')).toHaveValue(second);
  await page.locator('#input').fill('观察当前房间');
  await page.locator('#send').click();
  await expect(page.locator('#task-state')).toHaveAttribute('data-state','partial');
  expect(gateway.requests.at(-1).context.task.actor.id).toBe(second);
  expect(gateway.requests.at(-1).context.scene.actors.selected).toBe(second);
});
