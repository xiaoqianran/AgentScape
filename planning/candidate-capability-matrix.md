# 候选版本能力矩阵

> 基线：main 分支，2026-11-16 阶段 0 收敛时建立。本矩阵描述**当前候选版本实际支持的范围**，是 README 与发布说明的能力依据；矩阵之外的世界、输入与环境不承诺同等支持。契约细节以 [v1 契约](public-contracts-v1.md) 为准，发布门槛以 [v2 发布清单](../docs/v2-release.md) 为准。
> 维护规则：能力状态变化时同步更新本文件，并在对应模块的 tasks.jsonl 中留任务记录；不把计划中的能力提前写成已支持。

## 版本口径

| 对象 | 版本 | 说明 |
|---|---|---|
| 引擎 / 工作区（根 package.json） | `2.0.0-dev.1` | 开发版本；生成的世界文件中的 `engine` / `generator` 字段使用此口径 |
| SDK 发布候选（sdk/typescript） | `agentscape3d@2.0.0-beta.1` | 尚未发布到 npm；发布前用本地 tarball（见 sdk/typescript/README.md） |
| 数据契约 | Scene Project / Asset Package / Asset Recipe / StylePack 均为 v1 | JSON 是唯一规范格式；未知字段与不支持的 schemaVersion 明确拒绝 |

## 运行环境

| 环境 | 状态 | 备注 |
|---|---|---|
| Node.js 22.12+（SDK / MCP / Headless） | 支持 | 浏览器专属环境在 Node 中明确返回 `ENVIRONMENT_REQUIRES_BROWSER`，不静默降级 |
| 桌面 Chromium + WebGL2 | 主要支持与验收环境 | 帧率与长时间资源释放尚无正式测量（见发布门） |
| 其他浏览器 / 移动端 | 未验收 | 不据桌面 Chromium 结果宣称支持 |

## 入口

| 入口 | 状态 | 支持范围 |
|---|---|---|
| Starter（`/starter/`） | 支持，唯一推荐首次使用路径 | 仅 agent / cup / table / chair 四种内置物理资产；完成拾取、放置、改布局、下载世界 JSON 并重开 |
| Studio（`/`） | 支持（开发中产品面） | 完整编辑、风格切换、代码项目、生成任务中心；默认环境 suzhou-garden |
| TypeScript SDK（`AgentScape.open()`） | 候选，未发布 | 统一 Scene API；默认环境 monument-hall；浏览器专属环境不支持 Headless |
| MCP Server | 支持（本地） | 原 24 个工具保留，另加 9 个 Scene 工具；默认 loopback + Bearer 鉴权；不提供对 Studio 会话的直接控制 |
| Python Connector SDK | 支持（连接器用途不变） | 不承载运行时 |
| Observatory（`/observatory/`） | 诊断工具 | 可依赖产品内部做诊断；产品不反向依赖它 |
| 原生 Three.js 接入（`AgentScape.attach`） | 部分支持 | 宿主保留 renderer / camera / 原始资源所有权；仅显式注册的碰撞、导航与实体获得能力；**原生项目的保存 / 导入不支持**，不按完整作品包承诺 |
| 代码项目（`agentscape.code-project v1`） | 部分支持 | 经自身文档保存 / 重开（源码、嵌入资源、serialize 状态、Runtime 实体 / 资产、状态机快照 + integrity hash）；执行须显式 authorized:true，解析 / 检查不执行源码；不随 project-bundle 传输，网络依赖 / DOM / 闭包不存档 |

## Scene API（经 SceneFacade，三入口同一语义）

observe / addModel / setTransform / remove / replaceAsset / interact / verify / apply / setStyle / save / close 均可用。interact 返回 JobRef，由宿主推进真实模拟，getJob / waitJob / cancelJob 跟踪；apply 先全批校验再逐项事务，遇错停止，已成功项保留，不保证全批原子性。SceneResult 分开记录执行状态、准入、验证与诊断：**添加成功不等于动作验证成功，Visual 不自动升级为 Physical**。

保存返回 `agentscape.project-bundle v1` 完整传输包（项目、锁、快照、必要资产字节、风格声明），hash 保完整性、不代表发布者签名；导入先校验版本 / hash / 依赖 / 能力并在新会话重新编译声明后安装，失败回滚，不执行存档源码。Code Project 不包含在该传输包内，走独立文档契约（见公共契约「代码项目（原生）」）。资源上限：项目 JSON 256 KiB、资源最多 128 项、单项 32 MiB、合计 64 MiB；实体总数不固定，激活 / 分页 / 存储有独立预算。

## 资产输入

| 输入 | 可达等级 | 备注 |
|---|---|---|
| 内置资产 | Visual / Physical / Interactive（按 Manifest） | 标准任务使用的即此类与程序化资产 |
| Asset Recipe v1 | Visual；Physical / Interactive 须显式声明 | 有界基础几何（box / sphere / cylinder）、分组、变换、标准材质；经 AssetCompiler 与准入 |
| 自包含 GLB | Visual | 加载前检查外部资源 URI、节点数与层级；请求 Physical 明确拒绝，不推断碰撞、不降级 |
| Three.js 代码资产（three-code） | Visual；声明 definition 时可达 Physical / Interactive | 经隔离执行后端构建并过准入与关节验证；保存恢复不重新执行源码 |
| Mechanical Draft / 程序化资产（MCP） | 按管线准入结果 | 高级源码走 MCP 执行后端；构建、准入、交互验证分别报告 |
| 通用目录 / 压缩包上传、YAML、任意 Shader 插件 | **不支持** | 不属于 v1 范围 |

## 代码执行后端

| 后端 | 用途 | 边界 |
|---|---|---|
| worker-wasm（QuickJS Worker） | 本机默认 | 时间 / 内存限制不是 OS 隔离 |
| trusted-local | 本地受信任源码 | 必须显式 `authorized:true` |
| os-isolated（Docker） | 公网不可信源码的唯一可接受后端 | 不可用时明确拒绝，不降级 |
| disabled | 拒绝源码 | SDK 默认 |

公网服务（`remote:true`）只接受 os-isolated / disabled。源码上限 32 KiB，序列化文档上限 2 MiB；AuthoringDocument 不传输动画、运行时回调、材质数组与外部纹理引用。

## 内置世界目录（modules/world/content/environments.js，共 8 个）

| ID | 名称 | 定位与支持说明 |
|---|---|---|
| industrial-cabinet-lab | 工业储物柜实验室 | 物理关节验证最完整的世界（双铰链柜门、双滑轨抽屉）；标准任务验收的主要场景 |
| monument-hall | 纪念大厅 | SDK 默认环境；物理、导航、智能体行为共享同一世界 |
| magic-cabin | 魔女小屋 | 内容最丰富；浏览器专属（依赖 DOM），Node / Headless 不支持 |
| woodland-workshop | 林间工坊 | 开放式工坊，含真实物理资产与原地文字编辑 |
| yuanmingyuan-western-mansions | 圆明园 · 西洋楼 | 大型程序化世界，含地形碰撞；以探索与展示为主 |
| suzhou-garden | 苏州园林 | Studio 默认环境；高精度视觉 + 简化地面代理，**逐建筑碰撞 / 导航 / 交互语义未完成** |
| ruined-courtyard | 遗迹庭院 | 视觉与探索为主 |
| grand-urban-block | 大型城市街区 | 视觉与探索为主，大世界可交互化在阶段 5 分区域推进 |

标准任务（CabinetCupTask：开柜、取杯、放桌、保存重开再执行）的验收范围以其集成测试覆盖的世界为准，**不扩展为全部内置世界均支持标准任务**。

## 明确不支持 / 已冻结

- 化学功能（反应、成分转化、化学求解器接入）：不建设。
- 热学扩张：已有 ThermalSystem 与热学资产保留可用与兼容，不新增开发任务。
- 从模型名称自动生成碰撞体、关节或抓取能力：不做；能力来自证据与声明。
- 多人协同、大世界流式化：无基准压力前不立项。

## 发布门状态（2026-11-16）

| 门 | 状态 |
|---|---|
| 本地工程验收（V2-PR-09） | 已通过（本地记录） |
| 独立首次使用（非开发者独立完成拾取 / 放置 / 保存 / 重开） | **未执行**（docs/first-use-check.md 仍为 not performed） |
| 候选提交托管 CI | 已通过（2026-11-16，提交 087da89）：AgentScape Check 运行 43807884100 全部 job 成功（含新分组 Tests core/ui/world），artifacts 已留存；后续候选提交仍须逐个通过 |
| 真实 GPU / 移动端性能测量 | 未执行；软件渲染结果不作为替代 |
| npm 发布 / 发布标签 | 未获授权，不执行 |
