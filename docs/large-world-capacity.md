# 大型世界改造：第一阶段基础与剩余工作

本次交付对象容量和分页基础，不是完整大型世界基础设施验收。World Document/Package v2、超过 64 MiB 的资源往返、资源流送与分块持久化尚未交付。旧包的内存保护没有删除，不能以此版本宣称支持任意规模的完整世界。

## 已实现的行为

- `ObjectStore.size` 直接读取 Map.size，O(1)，不复制对象列表。
- SceneFacade 创建及恢复不再检查世界对象总数；SceneProject v1、StarterProject v1 不再限制 32 个实体。
- `openScene` 将项目实体按 32 个操作分批交给既有 apply，保留单次请求约束和失败清理。
- `scene.observe({offset: 0, limit: 100})` 返回 `agentscape.scene-object-page`：objects、total、offset、nextOffset、revision。limit 为 1–1000，是返回页预算，不是世界总量。
- 分页不调用 store.list、全量关系图、演员列表或 affordance 计算。旧 `observe()` 返回结构和行为保持不变。
- 页码按当前插入顺序解释；并发修改后应重新开始遍历。这不是冻结快照，也不是空间索引。单页遍历 O(offset + limit)，输出分配与页大小相关；对象 state 自身的字节大小尚无独立预算。
- SDK 声明提供独立分页重载；MCP 原有接口保持不变，目前没有暴露新分页参数。

## 文件职责

| 文件 | 变化 |
| --- | --- |
| application/scene/SceneFacade.js | 去除总对象上限；对象分页；打开项目按请求批次处理 |
| application/scene/SceneProject.js | v1 解析允许超过 32 个对象，继续校验重复 ID |
| application/scene/StarterScene.js | Starter 对象数组取消 32 上限 |
| modules/world/runtime/ObjectStore.js | O(1) size 和有界输出 page |
| sdk/typescript/src/index.d.ts | 分页请求和独立返回类型 |
| tests/integration/scene-scale.test.js | 逻辑记录规模、分页无全量调用、物理对象保存恢复及失败一致性 |
| dev/experiments/world/003-scene-capacity.mjs | 本机可重复运行的逻辑/物理分离基准 |

## 源码限制审计

| 层级 | 位置及现状 | 处理 |
| --- | --- | --- |
| 持久对象总量 | SceneFacade.maxObjects=32；两个 project schema.max(32) | 本次移除 |
| 单次 API | apply 32；verify/plan 32；请求缓存 256；任务 128 | 保留，与世界规模分开 |
| v1 文本解析 | SceneProject UTF-8 256 KiB；Starter.load 256 KiB | 保留同步 JSON 路径保护；已解析项目对象可超过该文本预算 |
| v1 资源集合 | SceneProject resolver 128 文件、单个 32 MiB、合计 64 MiB，逐个 slice | 待 v2 替代；不得直接解除后无限分配 |
| v1 完整包 | 32 资产、Base64 字符串 45 MiB、累计 64 MiB、JSON 输入 96 MiB | 待 v2 替代；同一资产多实体不受实体数量限制 |
| Studio | bindSceneControls 96 MiB 后 file.text/JSON.parse；下载 stringify/Blob；本地快照同步保存 | 仍为兼容路径，未接入流式服务 |
| 单资源处理 | ProgrammaticAssetBuilder 4 MiB 编译结果和尺寸校验；GeneratedWorldLoader 全量解码/合并几何 | 属于处理预算，不是世界总量；未放宽 |
| 编辑事务 | WorldRuntime.mutate 前后完整 snapshot；最多 100 条历史 | 仍随世界规模增长；需增量 journal/checkpoint |
| 关系图 | SceneGraph.rebuild 两两检查；每次编辑可触发 | 新分页避开；编辑与兼容全量 observe 尚存在瓶颈 |
| 运行资源 | 活跃物理、导航重建、环境自有几何和纹理 | 未实现独立常驻预算，不能用逻辑记录测试代替 |
| artifact 管线 | 已有 IncrementalSha256；MemoryArtifactByteStore.commit 拼接全部字节；IndexedDbArtifactStore.load getAll | 可复用哈希算法，不可把现有存储直接称为流式持久化 |
| MCP | world_observe offset 最高 64，HeadlessWorldHost 先全量 observe 再切片 | 后续需独立迁移，现有工具兼容性本次保留 |

圆明园自身的植被数量/纹理分辨率质量控制是活跃视觉预算，不是世界对象业务限制。本次没有添加任何世界内容专用存储判断，没有更改魔女小屋、城市街区、空白世界或物理注册语义。

## 下一阶段接口方向（尚未实现）

1. v2 主清单只包含版本、世界元数据、插件声明、实体块描述与资源描述；实体块按稳定 ID 保存变换、状态及引用。资源记录应包含稳定 ID、SHA-256、声明字节数、媒体格式/版本、依赖与位置。内容地址与实体身份分开。
2. 使用可随机访问的目录/文件提供者和逐块读写接口，事务暂存写入后发布根清单；支持取消、清理失败暂存和重新打开。必须先实现磁盘或 IndexedDB 分块后端，再宣称有界内存；清单自身也需要页预算。
3. Portable 模式逐个复制并校验引用资源，按哈希去重；Linked 模式仅写引用并要求宿主提供可验证的资源解析器。远端访问由宿主策略控制，不能任意跟随未验证 URL。
4. 统一服务负责 Inspect → Validate → Prepare → Preview → Commit。Prepare 不改变当前 Runtime 或资源引用；Commit 通过可回滚会话切换发布。未知插件、版本、缺失依赖、错误哈希/尺寸必须给出结构化诊断。
5. 第一版可只接收目录提供者，明确拒绝 ZIP；若增加 ZIP，必须在解压前拒绝路径穿越、大小写冲突、符号链接和危险文件，逐条限制解压字节及压缩比，不做无限展开。
6. 激活控制器使用同一 ObjectStore 的逻辑身份，分离实体存在与视觉/物理激活；资源租约按哈希共享、引用计数、显式卸载、取消、重试与内存统计。不能另造 ECS，也不能默认执行上传脚本。

v1 scene/project-bundle 继续按原格式读取。v2 必须独立版本分派；不能把 Base64 v1 写入器静默改成缺资源的 linked 文件。迁移需通过稳定 ID、变换、状态、哈希的跨进程往返，以及超过 64 MiB、多次开关、坏资源回滚等测试后才算完成。

## 验证与性能

性能原始数据见同目录 `large-world-capacity-results.json`，命令为 `node --expose-gc dev/experiments/world/003-scene-capacity.mjs`。这是单次本机微基准，非统计分位数。逻辑测试直接写入既有 ObjectStore，再通过真实 Facade 查询；不包含 apply 的历史快照、几何、物理或导航成本。物理测试使用未经裁剪的 Runtime、Rapier 和内置杯子。

实测环境：2026-11-06，PC2 Windows 10.0.26300 x64，i5-12400F（12 逻辑核），31.86 GiB 内存，Node v24.18.0，无渲染器。首轮未与仓库构建/测试并发。

| 实体类型 | 数量 | 创建/打开 ms | 首页面查询 ms | 遍历所有页 ms | 创建后 GC 堆 MiB | RSS MiB |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 轻量逻辑记录 | 100 | 0.59 | 0.68 | 2.53 | 25.62 | 100.78 |
| 轻量逻辑记录 | 1,000 | 3.36 | 0.30 | 5.06 | 27.76 | 104.25 |
| 轻量逻辑记录 | 10,000 | 43.47 | 0.28 | 42.59 | 46.60 | 173.97 |
| 真实物理杯子 | 100 | 161.61 | 0.82 | 未单独测量 | 35.45 | 176.83 |
| 真实物理杯子（补充测量） | 1,000 | 46,688.54 | 2.91 | 单页包含全部 | 167.92 | 484.58 |

逻辑查询每页 100；物理查询一次返回全部 100 或 1,000。堆内存是整个进程的绝对值，不能当作单个资源大小。补充测量设置 `SCENE_PHYSICAL_COUNT=1000`，原始数据在 `large-world-capacity-physical-1000.json`；其中短暂并发了一次 4.58 秒的定向测试，不能视为严格独占机器的基准。物理数量从 100 增至 1,000 后打开时间显著恶化，不据此虚构 10,000 物理实体数据，也不把原因单独归结于硬件。

验证结果：

- `npm run check`：345 个测试文件通过，1,719 项通过、2 项跳过，类型检查和构建通过。
- `npm run sdk:verify`：独立安装、Worker、MCP 入口及新进程恢复通过。
- 关键浏览器：asset-import 1 项、starter 2 项、studio 5 项通过。中途服务重启打断了首轮浏览器进程；已单独重跑未完成的全部 Studio 用例，5/5 通过。
- 最后补充“100 实体导出包 → 关闭 → 打开包 → 比较所有实体状态/变换”的断言后，容量文件 5/5 再次通过。生产代码在完整 check 后未变化。
- 构建存在既有大 chunk、浏览器外部化和无效动态导入警告，未修改阈值或屏蔽 CI。

关闭后的 RSS 不保证立刻下降，WASM/JS 分配器可能保留内存；闭包仍可持有场景/历史。此基准不是资源无泄漏验收，GPU 内存也未测量。10,000 个完整物理对象尚未验证。超过 64 MiB 的新格式测试尚不存在，因此总任务验收未完成。
