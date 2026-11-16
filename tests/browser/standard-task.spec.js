import { test,expect,enterWorld,verifyRenderedWorld,expectSameCanvas } from './fixtures.js';

test('standard scene prepares through the UI and a missing cup blocks the model request',async({page,gateway},testInfo)=>{
  await enterWorld(page);
  await page.getByRole('button',{name:'编辑',exact:true}).click();
  const canvas = await verifyRenderedWorld(page,testInfo);
  await page.locator('#open-world-task').click();
  await page.locator('#check-standard-task').click();
  await expect(page.locator('#standard-task-conditions')).toContainText('TASK_CUP_NOT_IN_CABINET');
  await page.locator('#run-standard-task').click();
  await expect(page.locator('#check-standard-task')).toBeEnabled();
  expect(gateway.requests).toHaveLength(0);
  await page.locator('#prepare-standard-task').click();
  await expect(page.locator('#task-state-label')).toHaveText('标准场景已准备');
  await expect(page.locator('#standard-task-conditions')).toContainText('world-provisional');
  await expect(page.locator('#scene-object-list [data-object-id]')).toHaveCount(4);
  await expectSameCanvas(page,canvas);
  await page.locator('#scene-object-list [data-object-id="cup_01"]').click();
  await page.locator('#delete').click();
  await expect(page.locator('#scene-object-list [data-object-id="cup_01"]')).toHaveCount(0);
  await page.locator('#open-world-task').click();
  await page.locator('#run-standard-task').click();
  await expect(page.locator('#standard-task-conditions')).toContainText('TASK_OBJECT_MISSING');
  expect(gateway.requests).toHaveLength(0);
  await page.locator('#undo').click();
  await expect(page.locator('#scene-object-list [data-object-id="cup_01"]')).toBeVisible();
  await page.locator('#scene-object-list [data-object-id="cup_01"]').click();
  await page.locator('#open-world-task').click();
  await page.locator('#input').fill('查看我选择的杯子');
  await page.locator('#send').click();
  await expect.poll(()=>gateway.requests.length).toBe(1);
  const intent = gateway.requests[0].messages.find(message=>message.role==='user').content;
  expect(intent).toContain('对象引用（只针对这个真实对象）：{"source":"runtime","id":"cup_01"}');
  await expectSameCanvas(page,canvas);
  await expect(page.locator('#viewport canvas')).toBeVisible();
});

test('standard task runs to verified completion through the UI',async({page,gateway},testInfo)=>{
  // planSceneTask only accepts live relation-exists / state-equals criteria
  // (TASK_GOAL_KIND_UNSUPPORTED otherwise); the CabinetCup interaction
  // criteria are tracked as verified mutations, and the plan carries the
  // final live postcondition: cup ON table top.
  const criteria=[
    {id:'cup-on-table',kind:'relation-exists',subject:'cup_01',predicate:'ON',object:'table_01',surfaceId:'top'}
  ];
  const steps=[
    ['planSceneTask',{criteria}],
    ['interactScene',{goalId:'cup-on-table',interaction:{action:'open',actor:'agent_01',target:'cabinet_01'}}],
    ['interactScene',{goalId:'cup-on-table',interaction:{action:'pickup',actor:'agent_01',target:'cup_01'}}],
    ['interactScene',{goalId:'cup-on-table',interaction:{action:'place',actor:'agent_01',target:'table_01',surfaceId:'top'}}]
  ];
  let round=0;
  gateway.respondWith(()=>{
    const step=steps[round++];
    return step
      ? {message:'',toolCalls:[{id:'journey-'+round,name:step[0],args:step[1]}]}
      : {message:'标准任务已完成：杯子已放到桌面。',toolCalls:[]};
  });
  await enterWorld(page);
  await page.getByRole('button',{name:'编辑',exact:true}).click();
  await verifyRenderedWorld(page,testInfo);
  await page.locator('#open-world-task').click();
  await page.locator('#prepare-standard-task').click();
  await expect(page.locator('#task-state-label')).toHaveText('标准场景已准备');
  await page.locator('#check-standard-task').click();
  await expect(page.locator('#run-standard-task')).toBeEnabled();
  await page.locator('#run-standard-task').click();
  await expect(page.locator('#task-state-label')).toHaveText('任务已完成',{timeout:150_000});
  expect(round).toBe(5);
  expect(gateway.requests).toHaveLength(5);
  await expect(page.locator('#scene-object-list [data-object-id]')).toHaveCount(4);
});

