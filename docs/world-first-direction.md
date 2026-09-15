# World-first：当前产品方向与验收门槛

2026-09-16。以双层小屋作为当前主场景，先把一个世界做成 Agent 可以持续完成任务的工作场所。Studio 以世界为主界面，生成、编辑、操作和检查使用上下文浮层；Observatory 维持 Runtime 诊断职责，只共享世界与诊断覆盖层。

## 当前已落地

- 原小屋几何、陈设与交互动画接入同一个 WorldRuntime。源 HTML 保留，迁移脚本可重跑。
- 场景交互契约拥有稳定 ID、状态、允许动作与验证函数。`listWorldAffordances` 发现，`inspectWorldAffordance` 检查，`executeWorldAction` 执行。任务观察提供发现入口、相关物件状态及最近结果。
- Agent 必须有身体、距目标 1.5 米内且无遮挡。射线读取生产 PhysicsSystem 的碰撞来源；文本在不可达时隐藏内容。编辑模式通过同一状态命令修改，编辑权限允许远程操作。
- 门窗、抽屉、抽书等待实际动画状态稳定，超时、暂停、世界替换不会报告成功。灯和文本按实际状态验证。结果显式携带 `evidenceKind` 与 `physicsVerified:false`；这些陈设还不是力学关节或可抓取资产。
- 支持契约的门窗、抽屉、书、灯、文字进入场景快照与历史恢复。不是所有装饰动画都可回放。物理世界重建后，动态环境碰撞体会重新创建。
- 迁移的纸面材质使用原生标准材质；加入天光、单张 1024 阴影图的太阳光与三盏局部灯，保留线稿。局部光没有阴影，不等同于原作的楼层光照遮罩或 Blender 渲染。
- 减少固定步内全树矩阵更新；静态建筑矩阵冻结；移动碰撞体只在位姿变化时同步，每步只合并触发一次导航失效。
- 开发设置展示帧间隔 P50/P95、渲染提交 CPU P95、draw calls 和三角形数。GPU 时间仅在后端实际提供时显示，未知保持空值。

## 接下来按顺序交付

| 优先级 | 交付 | 验收条件 |
|---|---|---|
| P0 | 一楼完整具身任务：进门 → 读任务 → 开柜 → 取杯 → 放杯 → 关柜 → 开灯 | 经生产 Agent 工具执行；用实际状态、接触/支撑、空间关系判定；改变杯位置和柜门初态仍能完成；失败返回原因。不得用传送或直接改状态替代抓取。 |
| P0 | 柜内空间与杯子成为真正资产 | 导入 AssetCatalog / ObjectStore；柜门有物理关节、内腔与可用容纳空间；杯子可抓取、携带、放置；人和 Agent 使用同一交互规则。 |
| P1 | 可通行的跨层楼梯 | 保留房屋风格，调整通行几何；默认 Agent 通过真实 Recast 路径和角色碰撞上下楼，不加入穿墙导航链接。 |
| P1 | 固定机器、视角、分辨率的画面与性能基线 | 记录 WebGPU / WebGL、设备、DPR、三角形、draw calls、CPU/GPU、帧间隔 P50/P95；同一条件比较前后。目标预算为主视角 P95 ≤ 20 ms，尚未验收。 |
| P2 | 世界内生成闭环 | 地点选择 → loading ghost → artifact → compiled asset → instance；生成物通过现有资产准入、碰撞和可达性检查。 |

实现优先投入交互与任务，其次画面和性能，最后新增界面。暂停以新页面数、装饰点击数或工具数衡量进展。Blender 继续作为高质量资产制作、材质与烘焙来源；AgentScape 的交付门槛是资产进入实时世界后可执行、可验证、可恢复。

## 当前证据边界

`tests/world/world-affordances.test.js` 验证注册工具、状态序列、条件阻断、超时取消、快照、灯光状态与真实 Rapier 遮挡。序列测试中的接近位置部分使用测试桩，不是完整 Agent 自主导航任务。既有小屋测试验证生产 Recast 的进门与二楼平面路径；跨层路径仍未通过。

`node dev/scripts/benchmark-cabin.mjs` 只测内容更新 CPU，排除渲染、物理和导航。它不能证明浏览器帧率。按用户要求，本轮不使用浏览器验证；没有像素验收、GPU 实测或 Blender 对比数据。

### 已验证基线（2026-09-16 阶段 0 基线冻结）

工作区在这六个提交上跑通 `npm run check`，exit code 0，提交前后各跑一次结果一致：

```text
architecture:validate   PASS  repository / domain / convergence
                              planning:validate  tasks 1152, ready 832
assets:validate         PASS  cabinet.glb, 3 named nodes
world:viability         PASS  verdict = runtime-world-usable
typecheck               PASS
test                    PASS  237 Test Files / 1114 Tests
build                   PASS  411 modules
```

与上面两条边界一起读，不得混写：

- `docs/physics.md` 记录的「180 test files / 858 tests @ 1bf17a6」已过时，实测为 237 / 1114。不要用旧数字判断规模。
- `world:viability` 的 `verdict = runtime-world-usable` 与 `worldAdmission = provisional` 是两个不同结论，不得合并。
- 构建存在多个超过 500 kB 的 chunk（`spark.module` 4.95 MB、`jolt-physics.wasm-compat` 3.56 MB、`physics` 2.85 MB、`three` 1.55 MB），属当前已知状态，供阶段 3 参考。
- 本轮仍未产生浏览器帧率、GPU 实测或像素验收数据。

基线提交：`632ff9a` `34aea9a` `98694ce` `b5b2991` `3db3f4c` `3e87b24`，父提交 `53aefc8`。

