# 任务库筛查报告（2026-11-16）

> 对象：全部 15 个 tasks.jsonl（筛查前 1182 条）。方法：全量结构统计 + 关键词筛查（已取消方向 / 已删除世界 / 失效引用 / 重复标题 / 空字段）+ 测试语料标识符比对 + 对候选逐条打开测试文件核对断言。处置原则：删除只针对有文档依据的失效任务；标 DONE 只针对能在现有测试中找到确切断言的任务；证据不足的一律保留并登记待核销，不凭推测关单。

## 总体结论

任务库没有方向性垃圾：化学（RDKit/Cantera/OpenMM/LAMMPS）、YAML、通用压缩包上传、多人协同、流式大世界、任意 shader 插件、已删除世界（良渚 / blank-world / house-world 等）在活动任务中命中均为 0，2026-11-14 的范围收敛已经落进任务库；无完全重复标题；全部活动任务的 criteria 非空。真正的问题是粒度、优先级与状态可信度（见“结构性问题”）。

## 数据画像（筛查前）

| 维度 | 分布 |
|---|---|
| 状态 | READY 878 / DONE 259 / DISCOVERY 29 / BLOCKED 14 / IN_PROGRESS 1 / DEFERRED 1 |
| 类型 | test 1087 / feat 45 / research 33 / refactor 8 / docs 7 / chore 2 |
| 优先级（活动任务 923 条） | P1 845 / P2 52 / P0 21 / P3 5 |
| 最大所有者 | modules/world 531、apps/studio 122、modules/agent 94、modules/asset 85 |

## 本轮处置

### 删除（6 条，均无外部依赖引用，删除后校验通过）

| ID | 理由 |
|---|---|
| APP-SCENE-API-001 | planning/README 已明示被 v2 链取代、仅作旧提案记录保留、不会再执行 |
| ARTIFACT-029、ARTIFACT-030 | zip bundle 预检；公共契约 v1 明确通用压缩包上传不属于 v1 |
| PHYSICS-172、PHYSICS-173、PHYSICS-174 | soft-body / cloth / fluid 可行性 spike；replan 明确无基准压力不扩张物理后端，且不在唯一优先闭环内 |

### 核销为 DONE（8 条，均在现有测试中找到确切断言，且全量测试已于同日托管 CI 通过）

| ID | 证据 |
|---|---|
| CONTENT-002 | tests/world/environment-catalog.test.js 直接断言 resolveEnvironment('does-not-exist') 返回 DEFAULT_ENVIRONMENT |
| ASSET-028 | asset-production-pipeline.test.js 断言 rejects with ASSET_IDENTITY_COLLISION |
| ASSET-032 | asset-production.test.js 断言 rejects with ASSET_ID_CONFLICT |
| ASSET-COMPILER-003 | asset-compiler-fetch.test.js 断言超限 fetch rejects with ASSET_INPUT_TOO_LARGE |
| ASSET-COMPILER-024 | segmentation-evidence-pass.test.js 断言 SEGMENTATION_COVERAGE_INVALID |
| PHYSICS-087 | physics-studio-api.test.js 断言 CARRY_BODY_UNSUPPORTED |
| NAVIGATION-024 | navigation-system.test.js 断言 reason END_OFF_NAVMESH |
| RULE-008 | rule-runtime.test.js 断言 rejects with RULE_CASCADE_DEPTH_EXCEEDED |

### 修正失效引用（3 条）

DOCS-002、DOCS-003、NAVIGATION-038 的 files 由 docs/physics.md、docs/navigation.md 改为实际存在的 docs/modules/physics.md、docs/modules/navigation.md。

### 新增（6 条，推进方案主线在此前完全无任务覆盖）

| ID | 内容 | 所有者 |
|---|---|---|
| APP-JOURNEY-001 | CabinetCup 标准旅程 Studio/SDK/MCP 三入口后置条件一致性核查 | application |
| APP-JOURNEY-002 | 五类失败旅程核查（缺失目标、重名歧义、路径阻挡、执行取消、损坏项目包） | application |
| APP-NATIVE-001 | 原生 Code Project（attach）保存与导入的支持边界（DISCOVERY） | application |
| ASSET-039 | 由几何、部件与关节证据生成候选能力并走审核注册 | modules/asset |
| BEHAVIOR-011 | 组合状态机：多部件状态联动（如门与锁） | modules/world |
| CONTENT-015 | 苏州园林选定一个区域补齐碰撞、导航与交互语义 | modules/world |

另：planning/candidate-capability-matrix.md 的“候选提交托管 CI”门已按 2026-11-16 实测结果更新为已通过（提交 087da89，AgentScape Check 运行 43807884100）。

处置后总量仍为 1182 条（删 6 增 6），planning:validate 通过，ready 队列 672 条。

## 疑似已覆盖、待逐条核销（35 条）

以下任务的特征标识符在同一个测试文件中成对出现，疑似已有覆盖，但抽查显示标识符命中不等于断言命中（如 PHYSICS-089、PHYSICS-090 的错误码只出现在 mock 中；RUNTIME-012 仅见构造未见空栈断言），故本轮不关单。后续核销标准：打开对应测试文件，找到与任务标题行为一致的确切断言后才标 DONE。

BASELINE-003、BASELINE-010、OBSERVATION-010、ASSET-020、RUNTIME-012、PHYSICS-035、PHYSICS-047、PHYSICS-048、PHYSICS-049、PHYSICS-089、PHYSICS-090、PHYSICS-119、PHYSICS-122、PHYSICS-138、NAVIGATION-023、NAVIGATION-032、SPATIAL-029、SPATIAL-030、INTERACTION-003、INTERACTION-018、INTERACTION-021、INTERACTION-029、INTERACTION-048、INTERACTION-066、WORLD-IR-015、WORLD-IR-016、BEHAVIOR-006、BEHAVIOR-008、BEHAVIOR-009、RULE-009、CONTENT-006、CONTENT-007、CONTENT-008、IMAGE-039、STUDIO-034。

另有 15 条仅在全语料层面命中 2 个以上标识符（未达同文件标准），证据更弱，一并按上述标准核销。

## 结构性问题与后续规则

1. **粒度过细**：852 条活动任务是“一条断言一个任务”的微型测试规格（占活动任务 92%）。它们作为覆盖清单有价值，但不是可排期的工作项。规则：后续按行为域成批执行、成批核销；不再新增断言级任务，新覆盖点写入对应行为域任务的 criteria。
2. **优先级通胀**：活动任务 92% 为 P1，优先级已失去区分作用。规则：P0 只给发布门与零容忍项（错误宣称成功、取消后继续执行）；新任务默认 P2，确属主线才标 P1。本轮未批量改优先级——无依据的批量改和通胀本身一样不可信。
3. **状态可信度**：本轮仅核销 8 条即说明 DONE 标记长期滞后于实现。规则：每轮工作结束时同步核销本轮涉及模块的任务状态，核销必须附测试断言级证据。
4. **保留项说明**：14 条 BLOCKED 均为“被 DISCOVERY 前置阻塞”的正常依赖链，随前置任务处置，不单独删除；29 条 DISCOVERY 除已删除的物理扩张 spike 外，均为有边界的调研项，保留。
