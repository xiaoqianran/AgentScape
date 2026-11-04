# Scene API、Asset Package、StylePack v1 最小契约草案

状态：设计提案，未发布、未实现。基线：`103cb20`。本文中的 API、格式和错误码均为目标契约，不代表当前可调用能力。现有 MCP v0.3 继续有效。

产品定位：AI 原生、可扩展的交互式 3D 世界引擎。首个交付目标是：创建真实项目文件，导入一个物体，放入世界，执行交互，保存并重新打开。自然语言生成是可选生产入口，不是打开项目的依赖。

## 1. 边界与所有权

| 契约 | 负责 | 不负责 |
| --- | --- | --- |
| Scene | 内容引用、实例变换、场景操作、保存与恢复 | 执行上传的源码、复制物理状态 |
| Asset | 可复用内容、源码、构建依赖、能力声明、不可变版本 | 决定某次世界动作是否成功 |
| Style | 材质、光照和效果的声明与兼容策略 | 修改对象 ID、碰撞、导航、关节或行为 |

公共门面放在 application，复用 AssetModule、WorldCommands、SkillRegistry、SceneSerializer 和 RenderingSystem。apps 负责文件授权、上传、认证和渲染容器装配；modules 不反向依赖入口。门面持有现有 Runtime 引用，不再维护对象列表、资产注册表或第二份运行世界。

源文件是创作输入；ObjectStore 是运行对象事实；SceneSerializer 是运行快照的唯一序列化实现。热更新只产生明确的变更请求，不让文件监听器直接修改 Three.js 场景。

## 2. 文件与引用约定

```text
my-world/
  scene.yaml
  scene.lock.json
  assets/fridge/
    asset.yaml
    model.js
    interaction.json
  assets/chair.glb
  styles/toon/style.yaml
```

YAML 和 JSON 解码为同一严格数据模型；YAML 禁止自定义标签、重复键、别名展开和非 JSON 数据类型。未知字段拒绝，扩展仅放在有命名空间的 `extensions` 中，未声明支持的必需扩展拒绝加载。限制文件大小、对象数量、嵌套深度及包总大小，由入口公布预算。

三种标识必须区分：作者命名的 package ID、锁定内容的 AssetRef、世界中的 instance ID。文件位置不是资产身份。所有运行依赖锁到内容哈希；人类可读版本号不能替代哈希。锁文件保存包摘要、构建环境摘要、产物引用和实际风格选择；不保存凭据和机器绝对路径。更新源码产生新版本，旧实例不自动升级。

本地适配器只解析用户打开的项目根目录内的相对路径，拒绝越界、符号链接逃逸和平台路径歧义。远程 API 只接收身份所属的上传包 ID 或已发布 AssetRef；不接收客户端本地路径，也不按任意 URL 抓取资源。

## 3. Scene 文件 v1

采用独立标识 `agentscape.scene-project`，避免与当前 `SceneSerializer` 的 `agentscape.scene` v1 运行快照冲突。

```yaml
schema: agentscape.scene-project
schemaVersion: 1
name: My first world
environment:
  type: builtin
  id: monument-hall
objects:
  - id: chair
    asset: ./assets/chair.glb
    level: visual
    transform:
      position: [0, 0, 3]
      quaternion: [0, 0, 0, 1]
      scale: [1, 1, 1]
```

首版 environment 只支持能力列表公布的内置环境。Photo Scene 是独立后续场景模式，不能用一张背景图宣称已经具有地面、遮挡和导航。

单位米，Y 向上，四元数为 x/y/z/w；数值必须有限，四元数归一化。缺省变换为单位变换。首版物理实体限定正的均匀缩放，Visual 是否允许非均匀缩放由实现验收决定，不能默默改变碰撞形状。实例 ID 在项目内唯一。

`asset` 的相对路径由项目解析器转换为锁定 AssetRef 后才能进入运行接口。场景文件描述初始布局，不承载实时抓取状态和求解器内部状态。运行保存通过现有 SceneSerializer 快照及依赖清单恢复；导出项目时另附运行快照引用。历史验证证据不得作为恢复后动作成功的依据。

### 薄 Scene API

以下是接口形状草案，不是已发布 SDK：

```ts
open({ projectRef?, environment?, renderer? }): Promise<SceneHandle>
scene.observe({ cursor?, limit? }): Promise<SceneObservation>
scene.apply({ requestId, expectedRevision, operations }): Promise<ApplyResult>
scene.interact({ requestId, actorId, action, targetId, parameters? }): Promise<JobRef>
scene.setStyle({ styleRef, fallback: 'reject' | 'declared' }): Promise<StyleResult>
scene.save({ requestId }): Promise<SaveRef>
scene.close(): Promise<void>
```

`renderer` 由浏览器适配器装配，远程请求不能传 DOM。SaveRef 是服务端标识；本地 CLI/浏览器适配器根据明确文件授权导出它，核心 API 不假设所有平台都能写磁盘路径。open 从 SaveRef 恢复时创建新会话。

首版 apply 只支持 add、setTransform、remove、replaceAsset，必须使用解析后的 AssetRef。move 是编辑变换；navigate、pickup、place、open、close 属于 interact 的真实动作，不能混用语义。能力查询决定哪些动作当前可用。

同一会话的编辑串行化。expectedRevision 不匹配返回 `REVISION_CONFLICT`；该修订号描述编辑提交，不随每个物理 tick 增长。正在交互或被持有的目标拒绝冲突编辑。物理动作不会承诺可回滚的批量事务。

首版 apply 明确采用顺序执行、遇错停止：先校验全批 Schema 和引用，再逐项执行；返回 applied、failed、notRun 各操作及最终 revision。单项失败使用现有命令回滚，已成功项保留。不得将部分成功表示为整批成功。全批原子语义不属于 v1，调用方可以先在新会话预览。

修改接口按身份、会话及 requestId 去重；相同 ID 不同参数返回 `REQUEST_CONFLICT`。observe 分页且返回 revision，列表游标不保证跨编辑一致，冲突时要求重读。长期任务返回 JobRef；job 状态包含 queued/running/succeeded/failed/cancelled/interrupted，支持查询与取消。任务完成、资产能力验证、世界动作验证分别报告。

统一诊断字段：code、message、stage、retryable、可选 location（包内路径、行列或 JSON Pointer）。堆栈、宿主路径及凭据不进入远程错误。主要错误包括 INVALID_DOCUMENT、UNSUPPORTED_VERSION、ASSET_UNAVAILABLE、CAPABILITY_UNAVAILABLE、REVISION_CONFLICT、REQUEST_CONFLICT 和 SANDBOX_UNAVAILABLE。授权失败不得泄露其他身份的资源是否存在。

## 4. Asset Package v1

```yaml
schema: agentscape.asset-package
schemaVersion: 1
id: example/fridge
version: 1.0.0
label: Refrigerator
entry:
  kind: procedural
  path: ./model.js
definition: ./interaction.json
```

entry 是互斥联合：`glb` 或 `procedural`，均引用包内文件。首版 procedural 保持现有同步 `export function createAsset(THREE)` 约定，返回受支持 Object3D；真实 `.js` 文件优先交付。`.ts` 在固定版本转译器、源码定位和隔离构建验收完成后才启用，当前不宣称支持。首版不支持外部 npm、安装脚本、动态导入或多文件代码模块解析。

definition 复用现有物理与交互 Manifest 语义，不设计另一套关节字段；source、最终 Asset ID、构建信息和验证证据由引擎生成。包保留原始源码及资源，与编译后的 GLB、Manifest、构建报告分别存储。

| 请求接入级别 | 必须具备 | 不可宣称 |
| --- | --- | --- |
| visual | 可加载几何、材质、有限变换和资源预算 | 有碰撞、能支撑或可交互 |
| physical | visual + 合法物理定义与真实刚体/碰撞注册证据 | 仅凭碰撞体就能开门 |
| interactive | physical + 声明动作所需节点、关节/支撑面等及对应验证 | 未运行就声称任意动作成功 |

级别是请求的接入能力，不替代 ready/provisional/rejected 及具体证据。无关节的 pickup/place 不强制制造关节；有 open 动作的冰箱必须验证其真实运动。请求级别不满足时明确拒绝，不自动降级。Visual 仍作为可保存的实体进入同一个 ObjectStore，不能仅作为无法恢复的渲染装饰。

当前程序化定义强制 physics；实现 Visual 时需要扩展准入与实体注册路径并测试，不得把 `physics` 删除后直接声称已支持。裸 GLB 默认 Visual，Physical 要显式选择碰撞配置，不自动猜测复杂交互。

### 上传与构建

本地 CLI 负责打包真实文件；远程入口通过受控上传取得 PackageRef。传输可以是有界分块二进制或协议附件，编码形式不是创作 API。首版只实现一个上传适配器，不预建通用插件框架。

上传须绑定身份、声明长度及摘要、配额和过期时间；完成后校验完整文件清单才成为可引用的不可变包。拒绝重复/大小写冲突路径、绝对路径、`..`、链接、压缩炸弹、额外未声明文件和超预算解压结果。未完成上传不可构建，取消/过期须回收。

构建继续使用现有无网络、无宿主挂载、资源受限的 Docker 隔离及输出验证。文件上传不构成源码信任。源文件、定义、依赖与工具链摘要共同决定版本；不以文件时间戳缓存。GLB 导入拒绝外部资源引用，所有依赖必须在包内且可解析。不兼容的 Shader/回调必须报告，不能静默丢弃。

复用现有异步构建、准入、发布、所有权、内容校验和可信保存流程。现有 `asset_build_submit(source)` 保持兼容，CLI 自动读取文件后提交可以作为过渡，但不能把它描述成已经完成资产包协议。

## 5. StylePack v1

```yaml
schema: agentscape.style-pack
schemaVersion: 1
id: example/toon
version: 1.0.0
requires: [material.toon]
parameters:
  palette: pastel
fallback: reject
```

示例只描述目标格式；`material.toon`、`palette` 均需要实际能力实现及 Schema 注册后才能使用。能力表来自当前 renderer backend，不能仅靠作者写 `webgpu` 或 `webgl` 宣称兼容。未知参数拒绝。首版默认拒绝缺失能力；可声明已安装、哈希锁定的回退 StyleRef，经调用方选择 declared 后使用，检测循环并返回 requested/applied/warnings。Headless 可保存风格引用，但返回 deferred，不伪装成已经渲染。

首版只支持引擎内置能力的声明式组合。可执行 TSL/Shader 插件、任意脚本加载、市场和运行时安装代码均不在首版。

切换采用准备—验证—替换：新材质/效果失败则保留旧风格；成功后释放旧派生资源。原始材质不可被破坏性覆盖，共享纹理按既有资源所有权释放；不更改 AssetRef 或资产哈希。新实体自动应用当前风格。动画/蒙皮/透明材质等不支持的转换必须报告或按声明保留原材质。

视觉可辨识变化不得偷偷写入物理材质、碰撞几何或导航障碍。保存只记录已解析风格引用与参数，恢复时重新检查能力。Realistic 表示保留原始 PBR 表现的基线；Toon 是材质转换；Low Poly 首版限定平面着色风格，不承诺几何减面。三者都必须有真实浏览器验收，WebGPU 专有效果不得作为 WebGL 已支持的证据。

## 6. 增量交付与验收门槛

1. **文件创作最短闭环**：版本化项目/包 Schema、一个 CLI 适配器、真实 model.js 示例、GLB Visual 与薄 Scene API。新用户从 Starter 创建、放置、保存、恢复一个模型；缺 Docker 时 GLB 路径可用，源码构建明确失败。冷安装与热启动耗时分开记录，五分钟是实测目标。
2. **共享入口与编辑**：MCP 与 Studio 复用门面；文件热更新防抖、明确错误位置、冲突提示、失败保留旧资产。远程上传验收越界、配额、取消、所有权；旧 24 工具兼容测试继续通过。仅新增有用户意图的入口，不逐个暴露内部方法。
3. **三个官方风格**：同一世界切换 Realistic/Toon/Low Poly；对象 ID、变换、碰撞、导航和交互结果保持一致。验证切换失败回滚、重复切换资源释放、保存恢复、各实际支持 backend 的画面与降级。
4. **冻结 v1**：示例和端到端测试覆盖跨入口一致性，公开兼容矩阵、迁移方式和包作者指南后，才将草案升级为稳定契约。发布非兼容变更必须升 schemaVersion，不能改写旧版本含义。

关键回归：项目文件不是执行任意代码的通道；Visual 不进入物理成功统计；apply 部分失败结果准确；样式切换不改变物理；服务重启可解析锁定资产；构建失败不污染已有世界。继续执行仓库 architecture/typecheck/MCP/world/check 检查，新增真实渲染验收与项目文件边界测试。

暂不实施 Photo Scene、任意持续脚本、通用模块替换框架、在线插件市场、多进程共同编辑或完整 npm 生态。生成服务作为可选适配器：缺少 provider 时报告能力不可用；`prompt` 不进入基础 add 操作，先生成 JobRef，再以完成后的 AssetRef 加入场景。

## 7. 当前代码对照

- `modules/world/runtime/SceneSerializer.js`：保留快照格式与恢复实现，增加项目适配而非替换。
- `application/programmatic-assets/ProgrammaticAssetContract.js`：复用显式定义，待补 Visual 与包输入。
- `apps/mcp-server/ProgrammaticAssets.js`、`FileAssetRepository.js`：复用构建、发布和内容校验；平台无关协调按需移到 application，Docker/磁盘实现保留入口适配，浏览器不导入 Node 文件系统。
- `modules/world/runtime/systems/RenderingSystem.js`：在现有渲染所有权上补样式生命周期，保持六系统边界。
- `APP-SCENE-API-001`：后续实施仍单独排期；本草案不把任何功能任务标记为完成。
