# AgentScape v1 数据与 Scene 契约

状态：2.0.0-dev.1 开发实现，未发布。JSON 是唯一规范格式；未知字段、不支持的 schemaVersion 明确拒绝。

| 契约 | Schema / 实现 |
| --- | --- |
| Scene Project | agentscape.scene-project v1；application/scene/SceneProject.js |
| Asset Package | agentscape.asset-package v1；modules/asset/model/AssetInputContracts.js |
| Asset Recipe | agentscape.asset-recipe v1；同上 |
| StylePack | agentscape.style-pack v1；modules/rendering/style/StylePack.js |

AgentScape.open() 返回 SceneHandle。SceneFacade 复用唯一 Runtime、ObjectStore、AssetModule、WorldCommands 和 SkillRegistry，不复制对象列表。

## 项目和资源

Scene Project 包含 name、environment、objects、可选 style。当前 environment 支持内置环境目录定义的 ID，例如 {"type":"builtin","id":"monument-hall"}；未知环境拒绝解析。对象有唯一 id、asset、level（visual/physical/interactive），以及可选 transform。不再固定限制 32 个实体，实际激活与分页有独立预算；位置范围 ±10000；四元数归一化；正均匀缩放 0.05–20。

引用支持 builtin://name、asset://sha256/<64位小写hash> 和安全 ./ 包内路径。解析器接收已提取的 resources Map，不读取主机文件或下载 URL。拒绝路径越界、Windows 特殊路径、大小写冲突。项目 JSON 文本限 256 KiB；资源最多 128 项、单项 32 MiB、合计 64 MiB。目录/压缩适配器仍需独立实现提取和符号链接安全边界。

save() 返回 agentscape.project-bundle v1 JSON 完整传输包，包含项目、锁、快照、必要资产字节和风格声明。内容 hash 保障完整性，不代表发布者签名。导入先校验版本、hash、依赖和能力，在新会话重新编译声明后安装；失败回滚，不执行存档源码。当前环境版本必须兼容。SceneSerializer 保留运行快照职责。

## 编辑与交互

observe/addModel/setTransform/remove/replaceAsset/interact/verify/apply/setStyle/save/close 通过同一门面。apply 先校验全批，再逐项事务；遇错停止并返回 applied/failed/notRun，已成功项保留，不保证全批原子性。requestId 支持会话内有界幂等；revision 随编辑历史变化，不随物理 tick 增加。

interact 返回 JobRef，宿主推进真实模拟；getJob/waitJob/cancelJob 跟踪任务。持有对象拒绝编辑。SceneResult 分开记录执行状态、准入、验证和诊断。Visual 不自动升级为 Physical，添加成功不等于动作验证成功。

## 资产与风格

Recipe 支持有界基础 box/sphere/cylinder、分组、变换、标准材质和显式能力；经过 AssetCompiler 与准入。普通自包含 GLB 可按 Visual 导入，无需 Docker。高级源码经 MCP Docker + QuickJS；默认浏览器 Agent 不暴露本地源码执行技能。历史手工可信创作 API 不能作为不可信第三方代码入口。

Asset Package 当前提供严格描述数据与既有资产管线入口，没有通用目录上传器。Node 默认 GLB 解码器不支持纹理图片时明确拒绝，浏览器支持内嵌图片。完整 Recipe 示例见 examples/recipes/table.json。

StylePack 支持 realistic/toon/low-poly，限定材质、灯光、背景、雾、阴影与内置渲染选项。准备、兼容校验、视觉替换、释放不修改对象身份、碰撞、导航或行为；失败恢复旧视觉状态。Headless 仅校验并延迟应用。社区包不执行 JavaScript 或任意 Shader。

## 兼容

Starter 保留旧输入适配器；SDK 使用正式项目。MCP 原 24 工具保留，增加 9 个 Scene 工具。Python Connector SDK 用途不变。统一业务规则不代表 MCP 会话直接控制 Studio 会话。其他 Studio 环境仍保留明确标记的历史快照导出。发布前外部验收见 docs/v2-release.md。
