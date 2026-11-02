# 产品验收后续执行边界

首批实现和证据入口见 [产品验收交接](../docs/product-acceptance.md)。本文只登记后续工作的已知依赖和待验收事项，不宣称里程碑 B 已完成。

## AS-03 真实模型评测

复用 `dev/acceptance/worldHarness.mjs` 的真实 Runtime 与 `application/tasks/CabinetCupTask.js` 的标准场景，不另造模拟物理。现有 `agent:probe` 只作为真实模型／模拟工具层的证据。

首轮固定 12 类：导航、开柜、取杯、持有后放置、柜内取杯多步任务、重名杯子歧义、缺少杯子、缺少桌子、可恢复柜门阻挡、不可恢复路径阻挡、桌面占用、保存重开后重新执行。每类五次为建议规模，尚未取得调用预算授权，不启动调用。

执行前记录网关与模型配置、场景版本、初始快照、规划步数／恢复步数／总请求上限和超时；每次先重置，失败不可删除或无限重试。报告按尝试保存工具参数与结果、真实验证器后置条件、停止原因、耗时及服务可提供的 usage；凭据不入报告。模型消息不作成功判据。普通可完成用例成功率、错误宣称成功数、故障后违规继续数分开统计；先发布基线，未运行不能填写成绩。

## AS-04 真实生成

固定 GLB 的 Python Connector 集成已单独运行并通过，详见交接。下一步需要明确的真实服务、凭据与预算，以一个简单可拿取非关节物体完成生成、Artifact 校验、编译准入和真实取放。无真实产物前保持未验收；`asset-provisional` 不改名为 ready。保留 Job 幂等、下载失败与重连测试边界，不把 Provider 实现移入本仓库。

## AS-05 迁移依赖梳理

当前各存储职责如下：

| 内容 | 当前权威存储／入口 | 迁移缺口 |
| --- | --- | --- |
| Runtime 场景与资产 Manifest | `modules/world/runtime/SceneSerializer.js`、`apps/studio/persistence/LocalSceneStore.js` | JSON 包含引用与清单，未自带所有资产字节 |
| 创作文档与晋升关联 | `apps/studio/persistence/AuthoringWorldStore.js` | 独立 IndexedDB；未与 Runtime 存档打成原子作品包 |
| 编译后的 GLB | `modules/asset/persistence/CompiledAssetStore.js` | 独立 IndexedDB 字节，JSON 导出不会自动带走 |
| 动态资产 Manifest 与资源库 | `modules/asset/persistence/AssetManifestStore.js`、`LocalAssetLibraryStore.js` | 须与字节、对象引用一起预检 |
| Artifact 描述与字节 | `modules/artifact/storage/IndexedDbArtifactStore.js` | 原始产物、编译物可能不同；须枚举必要依赖并验 hash |
| 内置／生成环境 | `apps/studio/runtime/WorldSession.js`、`application/generation/PromptHybridWorldOrchestrator.js` | 内置版本和生成环境所需的资源须显式引用 |

实现作品包前约定版本、Manifest 与字节映射、缺失外部依赖清单及冲突策略。导入先预检格式、hash、大小／复杂度、缺失引用、ID 冲突和存储配额，再应用；中途失败原项目保持完好。不能把多个独立 IndexedDB 的写入误称单一事务。密钥、配对令牌、临时下载地址、可重建导航／求解器缓存、进行中任务承诺不进入包；历史验收标记为历史。在干净浏览器恢复并重新运行标准任务前，迁移保持未验证。

## AS-07 发布阻断与未验证项

2026-11-02 本机 `npm audit --json`（未执行升级）报告 11 项：2 critical、3 high、6 moderate。涉及 Storybook / addon-mcp、Vite、Vitest mocker、sharp、source-map-js 等开发依赖链。完整本机日志 `.agentscape-audit.log` 不提交；正式发布前应按实际暴露面核验公告、升级兼容版本并回归，不能因生产构建通过就忽略开发服务风险。本轮不混入未评估的批量依赖升级。

另外尚无以下发布证据：冷启动和任务期间帧耗时／资源占用的正式测量、反复换世界的资源释放测试、完整作品包导入失败保护、真人首次使用、实体移动端性能。构建存在大分块警告，先测量再决定优化。支持环境目前以桌面 Chromium 与 Node 22 CI 为主，不能据此宣称所有浏览器支持。

没有 Connector、模型未配置、网关离线、权限拒绝、旧存档损坏须逐项记录浏览器结果；固定服务验收与真实在线验收分开。真人首次使用必须由未参与开发的人独立操作，Agent 不能自行签字代替。
