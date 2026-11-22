# 艾德米尔魔法学院（Eldermere Academy）

通过真实 AgentScape MCP → Studio Live Bridge 调用建立的原创 Three.js 魔法学院世界。
美术主题参考传统哥特式学院与奇幻城堡氛围，不复制任何现有电影场景或商标。

## 预览

在 AgentScape 开发服务器上打开：

`http://127.0.0.1:5173/examples/eldermere-academy/`

CNB 远程环境请通过端口 5173 的网页预览入口访问该路径。鼠标拖动旋转、滚轮缩放、右键平移，可切换全景、正门、塔楼和湖景视角。

- `world.js`：通过 `studio_project(write)` 运行并经过验证的 Three.js 世界源码（外加一处删除重复齿墙的清理）
- `eldermere-project.json`：通过 `scene_save` 导出后固化的完整代码项目
- `index.html`：便于远程浏览器直接打开的独立 Three.js 预览

## MCP 实际操作链路

1. `studio_sessions_list` 确定运行中的 Studio，会话选择使用明确的 `worldSessionId`
2. `studio_project(create_world)` 创建独立代码世界
3. `studio_project(write)` 写入代码
4. `studio_project(run)` 在真实 Studio 中启动渲染
5. `scene_observe` 识别 6 组项目场景对象
6. `scene_verify` 检查对象存在，6/6 通过
7. `scene_interact` + `scene_job` 验证开启和关闭魔法灯的交互
8. `studio_project(capture)` 捕获真实场景 JPEG
9. `studio_project(save)` 与 `scene_save` 持久化、导出世界

项目对象属于可交互的 Three.js 项目语义实体；对象存在和开关动作通过验证，**不等于整个城堡通过物理碰撞、导航或角色通行验证**。

## 混合编辑

Studio 世界工作台 → 「代码世界」 → 艾德米尔魔法学院 → 「可视化」。

- 代码创建的六组建筑/地形对象用 `scene.registerEditable({id,object,properties})` 显式声明可编辑属性，直接保留原 Three.js 对象和动画
- 编辑器新增方块进入 `NativeSceneHost` 的 Managed Scene Overlay，受同一 `SceneFacade` 管理
- 通过 `scene.apply({operations:[{type:'editNative',id:'grand_keep',changes:{position:[1,0,0]}}]})` 可以从 GUI 或 MCP 修改同一代码对象
- 编辑覆盖保存在代码项目的 `edits`，新增物体保存在 `runtime`；代码重运行、重新打开后恢复
- 未注册的普通 Three.js 对象仍由源码完全控制；代码持续改写的属性不应同时由编辑器控制

### Transform Gizmo（鼠标拖拽）

进入 Studio 左侧「可视化」选项卡，选择一个代码创建的建筑组（例如 `grand_gate`），或新增一个方块。

- **W / E / R**（或面板按钮）：移动 / 旋转 / 缩放
- **拖动 X/Y/Z 彩色轴**：只更新独立 Gizmo 预览，释放鼠标时通过统一 Scene API 写入
- **Esc**：取消本次拖动；**保存世界**：将编辑结果持久化到当前浏览器
- 建筑仍是代码最初创建的 Three.js 对象，不会自动复制成另一套 Mesh；普通编辑层资产仍受 Runtime 原有的等比缩放限制
- 变换提交带有启动拖拽时的世界修订号，如果 MCP 同时写入则拒绝过期提交，避免直接覆盖 AI 修改
