import { test, expect } from '@playwright/test';
import * as THREE from 'three';

// The published castle has an intentional fixed camera. Derive handle coordinates
// from its real scene camera and canvas size; never assume a hard-coded screenshot pixel.
async function projectCastlePoint(page, vector) {
  const rect = await page.locator('.studio-code-project-viewport canvas').boundingBox();
  if (!rect) throw Error('CODE_WORLD_CANVAS_NOT_FOUND');
  const camera = new THREE.PerspectiveCamera(48, rect.width / rect.height, 0.1, 600);
  camera.position.set(87, 60, 128);
  camera.lookAt(0, 23, -22);
  camera.updateMatrixWorld(true);
  camera.updateProjectionMatrix();
  const ndc = new THREE.Vector3(...vector).project(camera);
  return { x:rect.x + (ndc.x + 1) * rect.width / 2,
    y:rect.y + (1 - ndc.y) * rect.height / 2 };
}

async function findGizmoAxis(page, visual, center, axis, offsets) {
  for (const [dx,dy] of offsets) {
    const x = center.x + dx, y = center.y + dy;
    await page.mouse.move(x,y);
    const hint = await visual.locator('[data-gizmo-status]').textContent() || '';
    if (hint.split('当前轴：')[1] === axis) return {x,y};
  }
  throw Error('CODE_GIZMO_AXIS_NOT_FOUND: '+axis);
}

test('mouse drags a code-owned castle gate and a visual overlay through the single Scene API, then restores both',async({page})=>{
  const pageErrors=[];
  page.on('pageerror',error=>pageErrors.push(error.message));
  await page.goto('/studio/?page=world&codeWorld=eldermere-academy');
  await expect(page.locator('.studio-code-project-viewport canvas')).toBeVisible({timeout:60000});
  await page.getByRole('button',{name:'可视化',exact:true}).click();

  const visual=page.getByLabel('代码世界可视化编辑');
  const choices=visual.getByLabel('可视化对象列表');
  await choices.selectOption('grand_gate');
  await expect(visual.locator('[data-gizmo-status]')).toHaveAttribute('data-gizmo-status','active');
  const gateCenter=await projectCastlePoint(page,[0,16,1]);
  const gateHandle=await findGizmoAxis(page,visual,gateCenter,'X',[
    [24,0],[36,0],[48,0],[12,0],[24,12],[36,12],[48,12],[0,0],[0,12]
  ]);
  await page.mouse.move(gateHandle.x,gateHandle.y);
  await page.mouse.down();
  await page.mouse.move(gateHandle.x+85,gateHandle.y,{steps:12});
  await page.mouse.up();
  await expect(visual.getByRole('status')).toContainText('已通过统一 Scene API 提交拖拽',{timeout:35000});
  const gateX=Number(await visual.getByLabel('position X').inputValue());
  expect(gateX).toBeGreaterThan(1);
  await expect(choices).toHaveValue('grand_gate');

  await visual.getByRole('button',{name:'添加方块'}).click();
  await expect(visual.getByRole('status')).toContainText('已向当前代码世界添加方块',{timeout:45000});
  const overlayId=await choices.inputValue();
  expect(overlayId).toMatch(/^visual_[a-f0-9]{12}$/);
  const overlayCenter=await projectCastlePoint(page,[0,12,14]);
  const overlayHandle=await findGizmoAxis(page,visual,overlayCenter,'XYZ',[
    [4,1],[0,0],[6,2],[-4,-1],[8,4],[-8,-4],[12,0]
  ]);
  await page.mouse.move(overlayHandle.x,overlayHandle.y);
  await page.mouse.down();
  await page.mouse.move(overlayHandle.x+80,overlayHandle.y,{steps:12});
  await page.mouse.up();
  await expect(visual.getByRole('status')).toContainText('已通过统一 Scene API 提交拖拽',{timeout:35000});
  const overlayX=Number(await visual.getByLabel('position X').inputValue());
  expect(overlayX).toBeGreaterThan(1);
  await expect(choices).toHaveValue(overlayId);

  // All three gizmo modes are exposed; managed objects use uniform scaling.
  await visual.getByRole('button',{name:'旋转 E'}).click();
  await expect(visual.getByRole('button',{name:'旋转 E'})).toHaveAttribute('aria-pressed','true');
  await visual.getByRole('button',{name:'缩放 R'}).click();
  await expect(visual.getByRole('button',{name:'缩放 R'})).toHaveAttribute('aria-pressed','true');
  await visual.getByRole('button',{name:'移动 W'}).click();

  await visual.getByRole('button',{name:'保存世界'}).click();
  await expect(visual.getByRole('status')).toContainText('整个代码世界与编辑层已保存',{timeout:60000});
  await page.getByRole('button',{name:'源码',exact:true}).click();
  const code=page.getByLabel('完整代码项目');
  const source=code.getByLabel('世界源码');
  await source.fill((await source.inputValue())+'\n// Gizmo regression: rerun retained registered edits.\n');
  await code.getByRole('button',{name:'保存源码草稿'}).click();
  await expect(code.getByRole('status')).toHaveText('源码草稿已保存',{timeout:35000});
  await code.getByRole('button',{name:'运行代码世界'}).click();
  await expect(code.getByRole('status')).toHaveText('代码世界运行中',{timeout:60000});
  await page.getByRole('button',{name:'可视化',exact:true}).click();
  await expect(choices.locator('option[value="'+overlayId+'"]')).toHaveCount(1);
  await choices.selectOption('grand_gate');
  await expect(visual.getByLabel('position X')).toHaveValue(String(gateX));
  await choices.selectOption(overlayId);
  expect(Number(await visual.getByLabel('position X').inputValue())).toBeCloseTo(overlayX,4);

  await visual.getByRole('button',{name:'保存世界'}).click();
  await expect(visual.getByRole('status')).toContainText('整个代码世界与编辑层已保存',{timeout:60000});
  await page.reload();
  await expect(page.locator('.studio-code-project-viewport canvas')).toBeVisible({timeout:60000});
  await page.getByRole('button',{name:'可视化',exact:true}).click();
  const restored=page.getByLabel('代码世界可视化编辑');
  await expect(restored.getByLabel('可视化对象列表').locator('option[value="'+overlayId+'"]')).toHaveCount(1);
  await restored.getByLabel('可视化对象列表').selectOption('grand_gate');
  expect(Number(await restored.getByLabel('position X').inputValue())).toBeCloseTo(gateX,4);
  await restored.getByLabel('可视化对象列表').selectOption(overlayId);
  expect(Number(await restored.getByLabel('position X').inputValue())).toBeCloseTo(overlayX,4);
  expect(pageErrors).toEqual([]);
});
