# 标准旅程一致性与失败旅程核查（2026-11-16）

> 对应任务：APP-JOURNEY-001（CabinetCup 三入口一致性）、APP-JOURNEY-002（五类失败旅程）。方法：逐入口查实现与测试证据，只认测试文件中的实际断言，不认文档宣称。

## APP-JOURNEY-001：CabinetCup 标准旅程四入口矩阵

规范旅程定义：application/tasks/CabinetCupTask.js（WorldIR + CABINET_CUP_TASK_CRITERIA + inspectCabinetCupTask 后置条件检查）。

| 入口 | 覆盖 | 证据 |
|---|---|---|
| Runtime 验收（scripted gateway） | 完整 | dev/acceptance/cabinetCup.mjs + tests/e2e/cabinet-cup-acceptance.test.js：三世界各三次重建，后置条件由 inspectCabinetCupTask 核验，含四类故障注入 |
| MCP | 完整 | tests/mcp/remote-mcp.test.js：经 MCP 协议真实执行开柜（approachAndInteract）→取杯（approachAndPickup）→放桌（approachAndPlace）并导出，含会话隔离与证据收集 |
| Studio（浏览器 UI） | 部分 | tests/browser/standard-task.spec.js：覆盖 UI 准备标准场景、条件检查（TASK_CUP_NOT_IN_CABINET、TASK_OBJECT_MISSING）、运行门控与对象引用意图；未在 UI 内跑完取杯旅程并断言后置条件 → 缺口 STUDIO-037 |
| TypeScript SDK | 无 | SDK 为 Scene API（open/attach/openProject），全仓无测试从 sdk/typescript 导入并执行旅程；Python SDK 同样无 → 缺口 APP-JOURNEY-003 |

## APP-JOURNEY-002：五类失败旅程矩阵

| 失败类 | 覆盖 | 证据 |
|---|---|---|
| 缺失目标 | 完整 | 验收故障注入 missing-target（删除 cup_01 后可解释地停止并保留真实状态）；单元层 OBJECT_NOT_FOUND 稳定错误（object-store、scene-api 等） |
| 路径阻挡 | 完整 | 验收故障注入 blocked-door、unreachable、occupied-surface；occupied-surface 时断言杯子仍由 agent 持有（heldAfterFailure） |
| 执行取消 | 完整 | tests/agent/task-cancellation.test.js 四例：中止在途模型请求且不执行其变更、等工具安全边界并保留已验证变更与持物、取消 pending 到安全边界后以新观察重试 |
| 重名歧义 | 缺口 | 编译域有歧义处理（PART_NODE_AMBIGUOUS、锚点歧义等），但运行时资产解析不 fail-closed：AssetCatalog.resolveExisting 多命中时返回 status=found 与最多 5 个候选，GenerationRuntime 原样上交，无 ambiguous 状态 → 缺口 ASSET-040 |
| 损坏项目包 | 完整（2026-11-16 更正） | 初版核查只看了 scene-import.test.js 的用例标题，漏了用例内部与相邻文件的断言，现更正：MCP scene_import 篡改资产 sha256 → 报错且先前导入对象完好（scene-import.test.js）；篡改 editable 定义 → PROJECT_INTEGRITY_MISMATCH（project-asset-lifecycle.test.js）；SDK 包导入失败保留旧世界（scene-package.test.js 用例名即 preserves the old world on failed import）；序列化层拒绝不支持的 schemaVersion（scene-serializer.test.js）。原子性机制是导入前完整性预检。残余说明：未单独演练“多资产包在第二个资产处失败”的中途回滚，预检使该路径不可达的部分已由上述用例覆盖 |

## 处置

- APP-JOURNEY-001、APP-JOURNEY-002 核查完成，标 DONE；缺口已登记为 STUDIO-037、APP-JOURNEY-003、ASSET-040。APP-JOURNEY-004 经复核确认其验收标准已被现有测试覆盖（见上表更正），标 DONE，不再实施。
- 零容忍项（错误宣称成功、取消后继续执行）在已覆盖的旅程中未发现反例：故障注入均断言“可解释地停止并保留真实状态”，取消用例断言不执行被取消的变更。
