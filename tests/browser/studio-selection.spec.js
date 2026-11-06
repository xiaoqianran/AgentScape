import {test,expect,enterWorld,waitForRuntimeReady} from './fixtures.js';
test('selection is light, modes gate editing, and Escape closes menu before inspector',async({page,gateway})=>{
 await enterWorld(page);await page.locator('[data-object-id="cup_01"]').click();
 const dock=page.locator('.selection-action-dock');await expect(dock).toBeVisible();
 await expect(page.locator('#affordance-choice')).toHaveCount(0);await expect(page.locator('#delete')).toBeDisabled();
 await page.getByRole('button',{name:'编辑',exact:true}).click();await expect(page.locator('#delete')).toBeEnabled();
 await page.getByRole('button',{name:'探索',exact:true}).click();await page.keyboard.press('Delete');await expect(dock.locator('strong')).toHaveAttribute('title','cup_01');
 await dock.getByRole('button',{name:'属性',exact:true}).click();await expect(page.locator('#affordance-choice')).toBeVisible();
 await dock.getByRole('button',{name:'更多动作',exact:true}).click();await expect(page.locator('.selection-action-menu')).toBeVisible();
 await page.keyboard.press('Escape');await expect(page.locator('.selection-action-menu')).toHaveCount(0);await expect(page.locator('#affordance-choice')).toBeVisible();
 await page.locator('[data-object-id="table_01"]').click();await expect(page.locator('#inspect-subheading')).toHaveText('table_01');
 await page.keyboard.press('Escape');await expect(page.locator('#affordance-choice')).toHaveCount(0);
});
test('environment references and world changes use the shared dock',async({page,gateway})=>{
 await page.goto('/?page=world&world=magic-cabin&renderer=webgl');await waitForRuntimeReady(page);
 await page.locator('.cabin-catalog summary').click();await page.locator('.cabin-catalog button').filter({hasText:'木灯'}).click();
 const dock=page.locator('.selection-action-dock');await expect(dock).toBeVisible();await expect(page.locator('.cabin-interact')).toHaveCount(0);
 const nativeRow=page.locator('.scene-object-list[data-source="environment"] [data-object-id="cabin:table-lamp"]');
 await expect(nativeRow).toBeVisible();
 await nativeRow.click();
 await expect(dock.locator('strong')).toHaveAttribute('title','cabin:table-lamp');
 await dock.getByRole('button',{name:'让 Agent 操作'}).click();await expect(page.locator('.task-object-reference')).toContainText('cabin:table-lamp');
 await page.locator('#input').fill('观察这个对象');await page.locator('#send').click();
 await expect.poll(()=>gateway.requests.length).toBeGreaterThan(0);
 expect(JSON.stringify(gateway.requests.at(-1))).toContain('cabin:table-lamp');
 await page.getByRole('combobox',{name:'当前世界'}).selectOption('monument-hall');
 await expect(dock).toHaveCount(0);await expect(page.locator('[data-object-id="cup_01"]')).toBeVisible();
});
test('quick actions fit a narrow viewport',async({page,gateway})=>{
 await enterWorld(page);await page.locator('[data-object-id="cup_01"]').click();await page.setViewportSize({width:390,height:844});
 const dock=page.locator('.selection-action-dock');await expect(dock).toBeVisible();
 const bounds=await dock.boundingBox();expect(bounds.x).toBeGreaterThanOrEqual(0);expect(bounds.x+bounds.width).toBeLessThanOrEqual(390);
 expect(await dock.evaluate(element=>element.scrollWidth<=element.clientWidth)).toBe(true);
 await dock.getByRole('button',{name:'更多动作',exact:true}).click();await expect(page.locator('.selection-action-menu')).toBeVisible();
 await page.locator('.editor-statusbar').click();await expect(page.locator('.selection-action-menu')).toHaveCount(0);
});

test('an in-flight action cannot submit twice or move feedback to a newly selected target',async({page,gateway})=>{
 await enterWorld(page);await page.locator('[data-object-id="cup_01"]').click();
 const dock=page.locator('.selection-action-dock');await dock.getByRole('button',{name:'属性',exact:true}).click();
 await page.locator('#affordance-choice').selectOption('pickup:');
 await page.locator('#execute-affordance').click();
 await expect(page.locator('#execute-affordance')).toBeDisabled();
 await expect(dock.getByRole('button',{name:'执行中…',exact:true})).toBeDisabled();
 await page.locator('[data-object-id="table_01"]').click();
 await expect(page.locator('#inspect-subheading')).toHaveText('table_01');
 await expect(page.locator('#actions .affordance-feedback')).toHaveCount(0);
 // The target-specific operation is still observable when returning to it.
 await page.locator('[data-object-id="cup_01"]').click();
 await expect(page.locator('#actions .affordance-feedback, #actions [role="alert"]')).toBeVisible({timeout:60000});
 await page.locator('[data-object-id="table_01"]').click();
 await expect(page.locator('#actions .affordance-feedback, #actions [role="alert"]')).toHaveCount(0);
 await expect(page.locator('#inspect-subheading')).toHaveText('table_01');
});
