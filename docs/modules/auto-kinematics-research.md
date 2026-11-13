# AgentScape 自动运动学与可验证交互：研究、实验和增量计划

> 2026-11-14。**状态：P0-A 候选分析已集成至 prepareAsset；P0-B 隔离机械筛选已提供显式 screenAsset，仍不接入生产资产注册或 Capability Admission。**
>
> 原则：未知模型可以产生候选，但名称、AI 意图、静态外形或独立仿真成功，均不能单独证明物体在真实意义上可开关/可操作。

## 1. 现有系统，无需重造

- `AssetCompiler` 已有 GLB 检查、结构和几何、候选关节、分割证据、face-label 部件物化、URDF JointFrame、碰撞体、审核、质量检查和 Manifest。
- `AssetModule.prepareInteraction/importReviewedGLB` 已具备候选 / 绑定源文件的人工审核 / 隔离物理验证 / 注册通路。
- `ArticulationVerifier` 已有 Rapier 关节驱动、目标误差、相互穿透、失速、稳定和返回零位检查。
- `CapabilityResolver` / `SceneJobController` 已能通过统一 `invoke` 调用资产、环境与代码项目能力。
- 缺口：无可靠自动 Part Discovery；静态模型缺少关节轴和锚点的确定性信息；当前语义提示主要来自名称/Provider；关节运动验证不等于原始物体功能验证。

## 2. 科研参考与技术取舍

1. **Artiverse（CVPR 2026）**：多视角 few-shot 分割 → 拓扑映射到网格 → bbox / 接触区域几何关节提案 → 人工多阶段确认。最贴合现有 AssetCompiler 的模块化思路。https://3dlg-hcvc.github.io/artiverse/
2. **URDF-Anything（NeurIPS 2025）**：3D 点云和语言模型共同推断 Part 和关节参数。作为后期高复杂度学习路线，不作为 P0 的强制依赖。https://proceedings.nips.cc/paper_files/paper/2025/hash/88445acb45c922bdb06952e31f8a60ec-Abstract-Conference.html
3. **Articulate-Anything（ICLR 2025）**：视觉-语言生成与批判反馈的闭环。借鉴迭代纠错，不直接引入其完整 Python/SAPIEN 依赖栈。https://articulate-anything.github.io/
4. **Articulate AnyMesh（CoRL 2025）**：开放词汇部件语义与关节构建。未来多视角分割路线。https://proceedings.mlr.press/v305/qiu25b.html
5. **PartNet-Mobility**：官方数据是 gated，条款限定非商业研究/教育；未经明确授权不得作为 AgentScape 公共资产库或商业训练集。https://huggingface.co/datasets/sapien-sim/PartNetMobility

## 3. P0 实际实验（仅候选，不授权）

### 3.1 GLB 已有动画轨道 → 运动学证据

- 源码：`dev/experiments/asset/motion-evidence.mjs`
- 测试：`tests/asset/motion-evidence-experiment.test.js`
- 不依赖 node name，解析 glTF animation 的 rotation / translation 关键帧；
  旋转轨道归纳一致的转轴和角度范围，平移轨道归纳方向和位移。
- 拒绝复合平移+旋转、轨道多轴不一致、不同 clip 冲突、rest pose 不匹配及暂不支持的插值。
- 真实二进制 GLB 写入/重新读取；8 个正反例通过。
- 该方法依赖**已经存在的动画**；无动画的静态模型不生成凭空关节。
- 输出只含 `candidate`、`executable:false`、`physicsVerified:false`；缺物理与功能证据。

### 3.2 静态面板几何 → 有歧义的轴线候选

- 源码：`dev/experiments/asset/static-panel-evidence.mjs`
- 测试：`tests/asset/static-panel-evidence-experiment.test.js`
- 只考虑轴对齐、实体前后面附近、尺寸覆盖合理的薄平板；读取真实 GLB 几何 AABB，不依赖物体名称。
- `public/assets/cabinet.glb` 全节点重命名后：找到一个面板候选；两个可能的竖直转轴线 x≈-0.82 / +0.80。**没有从证据中选定哪边是真铰链**。
- 小旋钮、远离前后侧表面的内部隔板不误认成面板候选。与门形状相同的装饰板依然会产生候选，因此语义功能不可从单姿态确定。
- 五项测试通过。实验完全不设置 joint limits，不自动构建 Part/动作，不注册。
- 局限：未处理任意旋转、复杂层级、非面板结构、单 Mesh 分割；AABB 不是精确接触几何。

### 3.3 复现与回归

在项目根目录执行：

```powershell
node node_modules/vitest/vitest.mjs run tests/asset/motion-evidence-experiment.test.js tests/asset/static-panel-evidence-experiment.test.js tests/asset/asset-compiler-part-proposal.test.js tests/integration/semantic-capabilities.test.js --maxWorkers=1
npm run architecture:validate
npm run typecheck
```

2026-11-14 已实际运行：4 个测试文件、22 项通过；仓库架构及类型检查通过。
仅限研究阶段自制与仓库资产的样例覆盖；还未执行外部数据集泛化评测、自动升格或新候选物理验证。

### 3.4 P0-A/B 接入现状（2026-11-14）

- `KinematicEvidencePass` 在明确调用 `AssetCompiler.proposeInteraction()` 时分析已有 glTF 动画与独立节点的轴对齐薄面板，输出 `proposal.kinematics.hypotheses`；普通 `compile()` 不因该实验默认运行复杂发现。
- `prepareAsset` 返回 `kh_*` 候选 ID、节点引用、观察或猜测的运动学轴/范围、缺失信息及 `executable:false`、`physicsVerified:false`、`functionVerified:false`。候选由现有 `proposalId` 和 `sourceHash` 绑定，改动源 GLB 会导致旧提案无法复用。
- `scene.screenAsset({kind:'glb',bytes,name,proposalId,hypothesisIds})` 重新计算提案并校验候选 ID，最多筛选四个候选；每个候选使用新加载的 GLB 构造临时关节/粗碰撞体，在独立 Rapier `ArticulationVerifier` 运行目标、碰撞、稳定和返回零位测试。
- **静态轴/限位没有真实证据**：只在临时物理世界用 ±0.5 rad 两个方向分别探测，保留每个方向的 `trials`；每个静态方向使用独立的单侧临时限位，避免回零电机越过未知零位造成误判。动画提供的范围只在其观察范围内做探测。质量 1kg、摩擦 0.5 和 mesh-local AABB 都是**仿真假设**，不是估计出的真实物理属性。
- 屏蔽非唯一节点名、缺失部件或根碰撞体、复合/含糊运动及耗尽候选预算；异常回传 `blocked` 与诊断码，不注册资产，也不发布语义动作。
- `mechanicalFeasible=true` 仅表示某一测试方向在这一组假设下仿真通过，**不能证明轴与原始机械结构一致**，仍需要功能验收和人工/外部证据。始终 `admission:'not-granted'`。
- MCP 复用 `scene_add_model` 的 `mode:'screen'`（与 `prepare` 同个 source，`model.proposalId`，可选 `model.hypothesisIds`）；Studio Live Bridge 复用同一 Scene API。
- 既有 `importReviewedGLB`、`ArticulationVerifier` 正式审核和注册流程保持不变。前端或 Agent 不得凭筛选状态伪造 `InteractionReview`。

## 4. 下一步建议的唯一架构主线

```text
Source GLB / optional motion / optional URDF / optional multiview
  -> Geometry & Part Evidence       (不可变来源、局部/世界坐标)
  -> Kinematic Hypotheses [N个]    (含替代轴/歧义及缺失证据)
  -> Per-hypothesis Physics Sandbox (只验证该机构可运行)
  -> Task-level Semantic Verifier   (独立验证通过、开口、取出等效果)
  -> Capability Admission          (每个能力逐项准入)
  -> Manifest + Scene.invoke / MCP (只有已授权动作开放)
```

严格区分：
- **观测**：动画/几何/URDF/来源对象哈希，不修改世界。
- **推断**：关节类型、轴、轴线锚点、限位、碰撞代理，允许多个候选。
- **物理可执行**：给定构造的机器能运动，仍不一定就是原物的真实机关。
- **语义功能正确**：一个与关节目标独立的检查器证明打开了可通行的开口、抽屉空腔可用等。
- **当前可用**：场景中 actor 距离、遮挡、占用、权限、动力学状态均允许本次执行。

所有证据应携带 `sourceHash`、`compilerVersion`、`motionSource`、`coordinateFrame`、`physicsBackendVersion`、参数来源及重验证策略。不能把 `physicsVerified` 用作物体真实语义的单一布尔值。

## 5. 分批开发计划与退出门槛

### P0-A：证据候选并入 prepare 读取路径（基本实现，已验收）

- 已将独立算法迁入 `AnimationMotionEvidence.js`、`StaticPanelEvidence.js`，并通过 `KinematicEvidencePass` 按需发现候选。
- 仅让 `AssetCompiler.proposeInteraction` / `scene.prepareAsset` 展示候选与缺失项；`compile` 和 `Manifest` 不自动提升任何未知动作。
- 目前保留 `nodeIndex`，筛选要求唯一节点名；重复节点名/不匹配节点保守拦截。未来可添加真正稳定的层级节点路径；当前 P0-B 只在临时测试 Rig 中把世界坐标轴线转换为根局部坐标。
- 已做到不运行大模型，非 prepare 编译不新增推断；后续须按哈希缓存同源候选并做中位数/p95 性能评估。
- 退出门槛：源文件换掉后证据失效、无法调用未批准的 `invoke`、原有 URDF/显式授权链路不回退。

### P0-B：多候选物理筛选（有限目标的隔离实现，已验收）

- 每个候选/方向独立加载 GLB、生成可回收的临时测试 Rig；当前 mass、friction、AABB、静态限位都明确标记为仿真假设，不宣称真实值。
- 当前复用 `ArticulationVerifier` 运行关节目标、碰撞、稳定、往返；不同摆位与参数灵敏度扫描尚未实现，列为后续质量项。
- 仿真通过只记录 `mechanicalFeasible:true` 和逐方向证据，**不**将候选升级为正式已授权资产或语义动作。
- 不通过的候选需有机器可读的失败原因、恢复策略和失败后的资源清理。
- 退出门槛：错误锚点、碰撞阻塞、假开门装饰板不会自动开放 `open`。

### P1：真正的 Part Discovery 和精确关系推断

- 已分离节点：利用拓扑组件、局部 OBB、层级和接触/间隙几何，替代实验中的轴对齐 AABB；候选轴可以多解。
- 单 Mesh：仅在低置信度或用户明确要求时调用多视角视觉分割 Provider，产出 faceLabels，复用 `SegmentMaterializePass`。
- Provider 输出视为**提案**，不得修改 source bytes 的有效性或篡改独立验证报告。
- 以固定小型自制 3D 样本为基准；扩展外部基准时逐一确认数据许可。

### P2：功能验证与复合交互

- 建立 `TaskVerifier` 独立语义检查，如打开后自由空间增大、抽屉可访问空间与接触面、开门后导航可达性。
- `cook` / `turnPage` 等动作可能由 Code Project 状态机与多阶段执行组成，不能只把转轴运动冒充完整业务功能。
- 对少量高价值对象做失败数据集、负例和 Agent 行为回归，再考虑自动审批。

## 6. 度量与对照实验

建议建立一个完全自制、可公开分发的小基准集：带真值关节的旋转件和滑动件、无运动的装饰件、错层级/错轴模型、单 Mesh，以及有/无动画的相同形态对象。

报告指标至少包含：
- Part proposal precision / recall；候选召回率分层报告，**不能把候选当成功执行**。
- 关节类型准确率、轴角误差、轴线位置误差（按模型包围盒对角线归一化）。
- 歧义集大小、排序正确率 top-1 / top-2。
- 物理隔离仿真通过率、碰撞回归率、双向返回成功率。
- 独立任务完成率及虚假功能准入率（**目标必须为零**）。
- 中位数及 p95 CPU/GPU 耗时、每资产资源开销、回退率。

本次 8/8 和 5/5 只覆盖自制单元测试及一件真实 GLB 的静态几何实例，**不能视为外部通用准确率**。任何面向未知静态 GLB 的准确率目标必须待固定评测集后确定。

## 7. 成本与工程边界

- P0 使用已有 Node.js、Three.js、glTF-Transform 和 Rapier；不下载大型模型，不使用云 GPU，不需要新增运行时后端。
- P1 可选调用视觉分割 GPU Provider，但输出离线缓存；`scene.observe`、`scene.inspect` 只读取既有能力结果，绝不在每帧推理。
- 不引入第二套 Action Executor、SceneFacade 或 PhysicsRuntime。
- 模型未知材质/质量必须标记为假设；单锚点搬运不可称为真实抓握力验证。
- 若发生误放行、性能显著回退或污染现有资产，立即关闭对应 evidence pass，继续保持旧版人工审核/显式关节路径。

## 8. P0-A/B 本轮实现范围

本轮将两类实验算法迁入 Asset Compiler 的只读证据层，新增 `screenAsset` / MCP `mode:screen` 的显式隔离筛选通路、定向测试和文档。
**生产 Runtime、正式 Asset Admission、Manifest Action、InteractionSystem/PhysicsSystem 算法及原有审核授权流程均未更改。**
没有引入云 GPU、外部模型或受限数据；来源、动作范围、碰撞代理等不确定性持续保留。
未经重验证，不应把隔离机械结果保存为正式 Asset 验证证据。
