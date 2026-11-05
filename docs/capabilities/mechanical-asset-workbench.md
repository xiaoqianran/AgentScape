# 机械资产创建工作台 v1

工作台将可编辑几何节点、明确的物理碰撞代理和运动关节编译为独立的 GLB 资产。使用原有 AssetCompiler、Manifest 和 ArticulationVerifier，不运行用户提交的 JavaScript，也不伪造物理验证结果。

## 在 Studio 中使用

进入「资源库 / Assets」，选择「创建机械资产」。

1. 加载工业储物柜模板，或导入机械草稿 JSON。
2. 编辑节点形状、局部位置、尺寸、颜色、父节点与碰撞开关。
3. 添加旋转铰链或滑轨，编辑运动轴、限位、目标、质量、刚度和阻尼。
4. 通过 3D 预览检查视觉结构；视觉预览不代表物理验证。
5. 确认碰撞代理与机械参数，执行「编译、验证并入库」。
6. 通过资源库放置到世界，或拖拽资产到目标位置。可导出草稿 JSON 备份与交给 AI 修改。

## 输入契约

- schema 为 agentscape.mechanical-draft，schemaVersion 为 1。
- components：最多 64 个节点，可选择 group、box、sphere 或 cylinder。
- motions：最多 12 个独立 revolute / prismatic 关节。
- 每个节点都有稳定 id、position、size、color、collision、parent。
- 每个关节有 id、node、type、axis、limits、open、mass、friction、stiffness、damping。
- v1 的每个关节必须引用根级 Group 轴心，不能形成嵌套移动关节。几何部件可属于固定根部或一个关节。
- collision 为 true 的部件转换为简化 Box Collider，而不是复杂曲面的精确碰撞。
- 必须有固定碰撞体；每个关节必须有运动碰撞体。旋转关节角度单位为弧度。

完整模板：[工业储物柜的机械草稿 JSON](../../examples/industrial-cabinet-mechanical-draft.json)。

## Agent / SDK / MCP

通过共同的 SceneFacade 创建，不必生成 Three.js 脚本：

~~~js
const draft = /* agentscape.mechanical-draft v1 JSON */;
const result = await scene.addModel({
  id: 'machine_01',
  asset: draft,
  position: [0, 0, 0]
});
console.log(result.admission);
~~~

createSession 注册的 addSceneModel Agent Skill 和 MCP scene_add_model 的 model.asset 同样接受机械草稿 JSON，后者使用 mode=add。

AssetModule.importMechanicalDraft 负责严格校验、确定性身份、GLB 编译和隔离关节验证。编辑原始定义会产生新的资产身份；已有的世界实体不会自动被新版本替换。

## 限制

- 适合规则机械与独立运动部件。多级串联机械臂、复杂雕刻曲面、软体和抓取器控制仍需更高级资产工作流。
- 编译注册成功不代表实际交互一定成功；Agent 仍可能被碰撞、站位与遮挡阻挡，须检查 Scene Job 最终结果。
- 草稿在当前浏览器本地保存；正式资产也需要其 IndexedDB 编译资源与 Manifest。仅导出 JSON 草稿不等于跨设备迁移整个已验证资产。
- 隔离关节验证针对审核后的代理物理模型，不代表真实材料力学参数已经测量。

## 验证

~~~sh
npx vitest run tests/integration/mechanical-asset-workbench.test.js
npx playwright test tests/browser/mechanical-asset-workbench.spec.js
npm run architecture:validate
npm run typecheck
~~~
