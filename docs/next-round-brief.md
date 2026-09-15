# AgentScape 下一阶段实施任务书（最终版）

2026-09-16。本文是多 AI 分发的最终版本，合并了三个来源：`docs/world-first-direction.md` 的优先级、工作区实际代码状态的核查结果、以及分发前的契约清点。

**本文是起点描述，不是事实保证。实施前必须核实当前代码状态。** 若本文与代码冲突，以代码为准，并在交付说明中记录该冲突。

---

## 0. 分发前必须已知的三个硬结论

这三条是核查代码后得到的事实，直接影响任务能否开工。不要跳过。

### 0.1 「读取便签」不在二楼以外——它在二楼，阶段 1 会卡住

任务链路要求 `开门 → 进入一楼 → 读取任务 → 开柜 → 取杯 → …`，但**一楼没有任何可读的文本契约**。

证据（三条互相印证）：

```text
modules/world/content/magic-cabin/cabinContents.js:7036-7039
  {id:'cabin:table-lamp', label:'一楼餐桌灯', ...}
  ...notes.map((note,index)=>({id:`cabin:note-${index+1}`, label:`计划板便签 ${index+1}`, ...}))

modules/world/content/magic-cabin/cabinContents.js:3739-3741
  const boardG = new THREE.Group();
  boardG.position.set(-2.9, FY, 2.8);

modules/world/content/magic-cabin/cabinContents.js:2459
  const FY = FLOOR_TOP;      // 即二楼楼面
```

代码注释亦直接写明：`/* ============ 便签编辑器（二楼计划板） ============ */`。

现有 text 契约只有两个：`cabin:sign`（屋外路牌，在开门**之前**）与 `cabin:note-1..N`（二楼计划板便签）。

**开工前必须选定一种改法，写进交付说明，不得两可：**

| 方案 | 做法 | 代价 | 建议 |
|---|---|---|---|
| α | 把「读取任务」改用屋外路牌 `cabin:sign` | 链路变为「读路牌 → 开门 → …」，失去「进门后读任务」语义 | 可接受但降级 |
| β | **在一楼新增一个文本契约**（例如一楼餐桌上的任务便签 / 门内侧贴纸） | 属新增内容，必须在交付说明里标注为「宿主扩展」而非「迁移内容」 | **推荐** |
| γ | 把「读取便签」移出阶段 1 验收链 | 与「一楼完整具身任务」验收冲突 | 不推荐 |

选 β 时：保持原作者署名 `YIBI2333` 与源文件 SHA-256 记录不变；新增内容与迁移内容必须分开标注。

### 0.2 一楼的「柜子」候选是 `storageChest`，不是衣柜

衣柜（`cabin:wardrobe-left/right` + `cabin:wardrobe-drawer`）在**二楼**，与「阶段 1 限定一楼」冲突，不得作为阶段 1 的柜子。

一楼现成的柜类对象：

```text
modules/world/content/magic-cabin/cabinContents.js:2412-2414
  const storageChest = new THREE.Group();
  storageChest.position.set(0, 0, -0.78);   // Y = 0，楼梯下储物箱，已有 storageLid 顶盖
```

### 0.3 任务书里「保留原几何」的说法要修正

`magic-cabin/README.md` 只要求：**原 HTML 不修改** + 保留陈设布局与署名。内部实现（柜门、柜内空间、楼梯）**可以重做**，前提是保留整体风格并说明改动。

但改动必须落在合法注入点，见第 5 节「改动落点规则」。

---

## 1. 所有 AI 共用的项目约束

### 项目

```text
D:\a_programming_list\A-Python-Project\wk08\AgentScape
```

### 参考原作（只读）

```text
D:\a_programming_list\A-Python-Project\wk08\web-012-line-art-style-magic-cabin\index.html
```

### 先阅读，不要先写

```text
docs/world-first-direction.md                     当前唯一优先级依据
modules/world/content/magic-cabin/README.md        迁移范围与已知限制
modules/world/runtime/interaction/WorldAffordances.js
docs/next-round-brief.md                           本文
application/skills/packs/affordanceSkills.js
modules/agent/prompt/index.js                      工具选择边界
docs/decisions-and-lessons.md                      30 条反例清单
```

### 产品目标

将双层小屋建设成一个**人和 Agent 都能操作、结果可验证、状态可恢复的世界**。

- Studio：以世界为主界面，使用上下文操作与原地检查。
- Observatory：诊断 Runtime、物理、导航与任务证据。
- Blender：资产制作、材质与烘焙工具。
- AgentScape：资产进入世界后的执行、交互、验证与恢复环境。

### 必须遵守

1. 检查并保留已有工作区修改，不重置、不覆盖其他 AI 的成果。
2. 不使用 agent-browser。本轮不做浏览器自动化；视觉与 GPU 验收不足时明确注明。
3. 不引入第二套 Runtime、独立物理循环或独立场景状态系统。
4. 不用瞬移、直接改状态或单纯播放动画冒充具身任务完成。
5. 区分动画状态、关节完成、持有关系、物理接触与放置支撑证据。
6. 不把点击节点数、工具数量或新增页面数当作产品完成度。
7. 优先复用现有能力。发现缺口后提出最小扩展，避免另建相同系统。
8. 生成文件通过迁移脚本修改；不要直接编辑后被重新生成覆盖。
9. 测试桩可以用于单元测试，但最终任务验收必须说明是否使用真实物理、导航与执行链路。
10. **验收必须使用非 editor 模式**。`WorldAffordances.execute(cmd,{editor:true})` 会跳过 1.5 m 距离与 Rapier 遮挡检查，仅限测试遍历契约时使用。
11. **每一步 mutation 都是 replan barrier**。`executeWorldAction` 与 `approachAndInteract/Pickup/Place` 均为 `mutates:true / batchable:false`，Agent 需要多轮 planning；并发写返回 `WORLD_MUTATION_BUSY`，不得用并发绕过。

### 协作规则

- 指定一个集成人（AI 0），统一维护共享接口与核心入口。
- 每个 AI 开始前列出负责文件；需要修改其他任务所属文件时，先向集成人提交接口需求。
- 优先使用独立分支或 worktree；若共享工作区，严格执行文件归属。
- 每个任务提交：改动说明、验证命令及结果、接口变化、已知限制。
- 未测、未完成与失败必须保留原始结论，不能包装为通过。

---

## 2. 阶段 0：基线冻结（必须先做）

**实测基线（2026-09-16 记录）**：

```text
HEAD      53aefc813d1ad9c7909b76c12749e37f8f89abce
branch    main
stash     （空）
node      v24.18.0
npm       12.0.2
工作区    30 个已改文件 + 19 个未跟踪文件
          diff --stat: 995 insertions(+), 506 deletions(-)
          其中 package-lock.json 占 962 行变更
注意      14 个文件有 CRLF→LF 警告；仓库已设 * text=auto eol=lf，
          提交时会自动归一化，属预期行为
```

未跟踪文件：

```text
modules/world/content/magic-cabin/**          整个小屋内容
modules/world/content/magicCabin.js
modules/world/content/woodlandWorkshop.js
modules/world/runtime/interaction/WorldAffordances.js
application/skills/packs/affordanceSkills.js
apps/studio/ui/WorldInteraction.js
apps/studio/ui/HumanViewController.js
apps/studio/ui/WorldContext.js
dev/scripts/benchmark-cabin.mjs
dev/scripts/migrate-magic-cabin.py
docs/world-first-direction.md
docs/next-round-brief.md
sdk/python/uv.toml
tests/world/magic-cabin.test.js
tests/world/woodland-workshop.test.js
tests/world/world-affordances.test.js
tests/studio/human-view-controller.test.js
tests/studio/world-interaction.test.js
tests/helpers/cabinCanvasHost.js
```

任务：

1. `git status` / `git diff --stat` 记录现状。
2. 运行 `npm run check`，记录真实结果。
3. 若全绿：按现有分组提交，交付说明中列出 commit hash。
   若非全绿：先修到全绿，不新增功能，只修基线。
4. 产出 `docs/world-first-direction.md` 的「当前证据边界」更新草稿。

禁止在阶段 0 顺便做功能。阶段 0 的唯一目的是让后续轮次可二分、可回滚。

### 实测结果（2026-09-16，已执行）

```text
npm run check   exit code 0  全绿

architecture:validate   PASS
  repository architecture validation passed (0 pinned submodules)
  domain architecture validation passed (core 5, artifact core 8, asset core 31, world core 51)
  convergence validation passed
  planning:validate  tasks 1152 / ready 832
assets:validate         PASS  cabinet.glb (3 named nodes)
world:viability         PASS  verdict = runtime-world-usable
                              worldAdmission = provisional
                              (ASSET_PROVISIONAL, LAYOUT_PROVISIONAL)
                              grandUrbanNavigation navBuildMs 226
                              ruinedCourtyardLocomotion arrived, y=1.22
                              embodiedTask acceptance 7/7 world-accepted
                              driftReplay 检出 cup-on-table 回归
                              restoredPersistentAcceptance 7/7
                              mutationOutcomes 全部 verified
                              (approachAndInteract / approachAndPickup / approachAndPlace)
typecheck               PASS  tsc --noEmit
 test                    PASS  237 Test Files / 1114 Tests
                              duration 19.84s
 build                   PASS  vite build, 411 modules, 898ms
```

**注意（文档漂移）**：`docs/physics.md` 声称的基线是「180 test files / 858 tests @ 1bf17a6」，实测已是 **237 files / 1114 tests**。
后续 AI 不得沿用 physics.md 的数字判断规模。

**构建告警（阶段 3 相关，不计失败）**：多个 chunk 超过 500 kB，其中
`spark.module` 4.95 MB、`jolt-physics.wasm-compat` 3.56 MB、`physics` 2.85 MB、`three` 1.55 MB。
这是当前已知状态，不是本轮引入。

**验收**：`npm run check` 全绿 + 一次干净的 commit + 工作区只剩有意保留的改动。

**建议的提交分组**（供集成人采用；本项目未 push）：

```text
commit 1  feat(world): migrate original magic cabin world pack
          modules/world/content/magic-cabin/**
          modules/world/content/magicCabin.js
          dev/scripts/migrate-magic-cabin.py
          tests/world/magic-cabin.test.js
          tests/helpers/cabinCanvasHost.js

commit 2  feat(world): add environment affordance contracts and agent skills
          modules/world/runtime/interaction/WorldAffordances.js
          application/skills/packs/affordanceSkills.js
          application/skills/registerCoreSkills.js
          application/skills/SkillRegistry.js
          application/buildTaskObservation.js
          modules/agent/prompt/index.js
          modules/world/runtime/WorldRuntime.js
          modules/world/runtime/SceneSerializer.js
          modules/world/runtime/systems/PhysicsSystem.js
          tests/world/world-affordances.test.js

commit 3  feat(studio): add world-context interaction and human view control
          apps/studio/**
          tests/studio/**

commit 4  feat(world): add woodland workshop pack and environment catalog update
          modules/world/content/woodlandWorkshop.js
          modules/world/content/environments.js
          tests/world/woodland-workshop.test.js
          tests/world/environment-catalog.test.js

commit 5  feat(rendering): add renderer probe and diagnostics
          modules/rendering/RendererProbe.js
          modules/world/runtime/systems/RenderingSystem.js
          apps/observatory/labs/physics/PhysicsLab.js
          apps/studio/ui/developer/DeveloperSettings.js
          tests/rendering/renderer-factory.test.js

commit 6  chore: add cabin tooling, baseline docs and dependency locks
          dev/scripts/benchmark-cabin.mjs
          docs/world-first-direction.md
          docs/next-round-brief.md
          docs/status-and-roadmap.md
          sdk/python/uv.toml / sdk/python/uv.lock
          package.json / package-lock.json
          .gitignore
```

回滚方式：`git reset --soft <baseline-53aefc8>` 后重分组，不丢改动。

---

## 3. 共享契约清点（AI 0 定对象清单直接采用）

### 3.1 世界交互契约（environment affordances）

契约由 `createCabinAffordances({hinges,switches,texts,drawers,books})` 在运行时生成。正确读数方式是 `listWorldAffordances` 返回的 `total` 或 `magicCabin.diagnostics().affordanceCount`。

**实测值（2026-09-16，`node dev/scripts/probe-cabin-stairs.mjs`）：**

```text
cabin.interactions.length            = 150   （点击节点）
cabin.affordances.length             = 56    （Agent 交互契约）
cabin.diagnostics().affordanceCount  = 56
cabin.colliders.length               = 233
cabin.diagnostics().movingColliderGroups = 19
```

最初 brief 里写的「150 个点击节点、56 个 Agent 交互契约」**两个数字都已实测确认**。
注意：56 是运行时推导值（9 hinge + 2 drawer + 5 switch + 1+N text + N book），不是源码常量，
因此上述清单变更后必须重新读取，不能沿用 56。

| kind | 数量 | 契约 ID | 楼层 |
|---|---|---|---|
| `hinge` | 9 | `cabin:front-door`、`cabin:front-left-window`、`cabin:front-right-window`、`cabin:left-window`、`cabin:attic-window`、`cabin:right-window`、`cabin:back-window`、`cabin:wardrobe-left`、`cabin:wardrobe-right` | 门/窗一楼，衣柜二楼 |
| `drawer` | 2 | `cabin:wardrobe-drawer`、`cabin:bedside-drawer` | 均二楼 |
| `switch` | 5 | `cabin:table-lamp`（一楼餐桌灯）、`cabin:chandelier`（二楼吊灯）、`cabin:candle`（二楼床头蜡烛）、`cabin:fireplace`（壁炉，有显式 position）、`cabin:heated-table`（暖桌） | 见括号 |
| `text` | 1 + N | `cabin:sign`（屋外路牌）、`cabin:note-1..N`（计划板便签） | 屋外 / **二楼** |
| `book` | N | `cabin:shelf-book-1..N` | 一楼书架 |

**一楼实际可用**：`cabin:front-door`、`cabin:table-lamp`、`cabin:fireplace`、`cabin:heated-table`、`cabin:shelf-book-N`。

已实现的现成阻断范例（可直接作为「前置条件阻断」回归参照，不要另造机制）：

```text
cabin:wardrobe-drawer open  →  需要 cabin:wardrobe-left / right 均已 open
                               否则返回 WARDROBE_DOORS_MUST_BE_OPEN
```

### 3.2 资产清单（已编译，可直接复用，无需新建模）

`modules/asset/manifests/index.js`：

```text
cabinet  source glb assets/cabinet.glb，requiredNodes ['Body','doorHinge','Door']
         colliders: 5 段壳体 box（左/右/底/顶/背），正面留空
         receptacles: [{ id:'interior', localPosition:[0,0.975,-0.01], size:[1.40,1.65,0.46] }]
         parts.door: node 'doorHinge'，actions ['open','close']，targets { open:-1.35, close:0 }
                     body dynamic，mass 8
                     joint revolute，axis [0,1,0]，limits [-1.35,0]
                     parentAnchor [-0.82,1,0.39]，childAnchor [0,0,0]，motor 80/12
cup      body dynamic，mass 0.3，actions ['pickup','drop','place','move']，collider cylinder
table    body fixed，surfaces [{ id:'top', localPosition:[0,1.1,0], size:[2.2,1.05] }]
agent    body kinematic，actions ['navigate']，embodiment.holdAnchor [0,0.95,-0.62]，
         navigationObstacle false，capsule halfHeight 0.53 radius 0.32
chair    surfaces [{ id:'seat', localPosition:[0,0.78,0], size:[0.7,0.7] }]
```

### 3.3 工具族边界（两族互斥，弄错必然失败）

| 族 | 工具 | 适用 |
|---|---|---|
| 环境契约族 | `listWorldAffordances` → `inspectWorldAffordance` → `executeWorldAction` | kind = hinge / switch / text / drawer / book |
| 资产族 | `approachAndInteract` / `approachAndPickup` / `approachAndPlace` | 力学关节、抓取、携带、放置 |

`executeWorldAction` 的 `action` 枚举只有 `open / close / turn_on / turn_off / read / write / pull_out / return`。**它按设计不提供 pickup / carry / place，不要扩枚举。**

`modules/agent/prompt/index.js` 已有明确规定：环境契约（如 `cabin:front-door`）必须用 `executeWorldAction`，**不得**用 `approachAndInteract` 或其他 asset-only 工具。

### 3.4 证据边界（不得修改）

```text
WorldAffordances 返回 physicsVerified:false 是硬编码的证据边界。
evidenceKind 只有三类：animated-transform / device-state / text-state。
verified=true 只代表该契约的 state post-condition 成立，
不代表力学校验过的关节、抓取、支撑或容纳关系。
除非真的接入了力学关节，否则不得把 physicsVerified 改为 true。
```

### 3.5 既有语义（复用，不要重做）

```text
访问判定 access()：距离从 feet+1.2 起算，> 1.5 m 返回 OUT_OF_REACH；
                   Rapier raycast 排除 actor，命中距离 < 目标距离-0.12 返回 OCCLUDED；
                   射线打到目标自身 colliderId（hinge 为 cabin:hinge:<index>）不算遮挡。
执行 pending：12 s 硬超时 SIMULATION_NOT_ADVANCING；
              update(dt) 累计 8 s 后 POSTCONDITION_TIMEOUT；
              同一目标并发返回 ACTION_IN_PROGRESS；
              场景替换调用 cancel(reason)（如 SCENE_RESTORE）。
模拟暂停时 animated-transform 契约返回 SIMULATION_PAUSED。
```

---

## 4. 任务分工

### AI 0：集成负责人——统一契约与最终验收

**职责**：明确各任务连接方式，整合成果，负责最终生产链路。

**独占维护范围**（其他 AI 不得直接并行修改，只能提交补丁建议）：

```text
modules/world/runtime/WorldRuntime.js
modules/world/runtime/SceneSerializer.js
application/skills/registerCoreSkills.js
application/skills/SkillRegistry.js
application/buildTaskObservation.js
modules/agent/prompt/index.js
modules/world/content/environments.js
apps/studio/main.js
```

任务：

1. 核实现有资产、导航、交互契约与测试能力。
2. **先解决第 0.1 节的「读取任务」硬冲突（选 α / β / γ 并写进交付说明）。**
3. 确定一楼任务使用的稳定对象 ID、初始位置与语义：房门、一楼可读任务文本、可开合柜子、柜内杯子、接收杯子的桌面、一楼可操作的灯。
4. 明确环境交互与 ObjectStore 资产之间的发现、执行与观察入口，避免同一柜门拥有两套互不一致的状态。
5. 统一任务证据结构，复用现有结果契约，不新造平行标准。
6. 接入其他 AI 的成果，完成真实任务：

```text
接近房门 → 开门 → 进入一楼 → 读取任务
→ 接近柜子 → 开柜 → 取杯 → 携带
→ 放到桌面 → 关柜 → 开灯
```

**验收**：

- 通过生产工具执行，使用真实导航与物理。
- 每步依赖上一动作的实际结果（注意 `mutates:true / batchable:false` 的 barrier 语义）。
- 至少覆盖：基础成功 / 杯子初始位置变化 / 柜门初态变化 / 路径或操作空间被阻挡 / 执行中保存恢复后的状态核验。
- 必须使用非 editor 模式。
- 区分「确定性工具编排通过」与「真实 LLM 自主规划通过」。没有运行后者时不得宣称已完成。
- 运行 `npm run check`，并提供一个可重复执行的任务入口。

---

### AI 1：资产与物理交互——柜、杯、桌

**负责范围**：

```text
modules/asset/**                                   选定资产的模型、manifest、编译输入与适配模块
modules/world/runtime/systems/InteractionSystem.js  仅交互语义修正（不含导航）
modules/world/runtime/interaction/**
tests/asset/**
```

不修改工具注册、导航后端、Studio 主入口。

任务：

1. 优先复用已有经过验证的柜、杯、桌能力，适配小屋尺寸与风格。
2. 将对象接入 AssetCatalog / ObjectStore，使用 AI 0 确定的 ID。
3. 柜子需要：真实可容纳杯子的内腔；门的碰撞体、关节、限位与开合目标；不被整块粗碰撞体封死的操作空间。
4. 杯子需要：合理尺度与碰撞体；接入现有抓取、携带、释放与放置链路。
5. 桌面需要有效支撑面及放置后关系验证。
6. 处理原装饰模型与新资产的替换，避免重复显示或碰撞体重叠（注意一楼已存在装饰性餐桌）。
7. 明确本实现验证到什么程度，不把运动学持有关系说成抓握力学验证。

**资产来源：无需决策 —— 方案 (a) 已在仓库中实现（详见 §9.2）**

`modules/world/content/environments.js` 的 magic-cabin 条目已带
`bootstrap:{agent:[6,0,-5], table:[7,0,2], cabinet:[7,0,5], cup:[7.35,1.4,2]}`，
`modules/agent/bootstrapWorld.js` 已按此 spawn `table_01 / cabinet_01 / cup_01`。

本任务**唯一**的资产侧改动：把 `bootstrap.cup` 从桌面改到柜内
（`[7.35,1.4,2]` → 建议 `[7,0.16,4.99]`），使「从柜中取杯」成立。

可选升级（保留、不在本轮）：把一楼 `storageChest`（`(0,0,-0.78)`，已有 `storageLid`）
升级为真实关节 + 内腔资产。二楼 wardrobe **与一楼限定冲突，不可用**。

注意：一楼装饰性餐桌（environment platform box）**不能**充当 `approachAndPlace` 的 `supportId`——
support 必须是 ObjectStore 中带 `manifest.surfaces` 的对象。若视觉上出现「两张桌子」，
需在交付说明中说明取舍。

**验收**：

- 杯子可放在柜内，柜门关闭后能正确阻挡访问。
- 开门后可取杯、携带并放置到桌面。
- 放置后通过真实支撑与空间关系判断成功。
- 门受阻、杯子操作空间不足时，返回失败或未验证结果。
- 保存恢复后，关节状态、物体位置与持有关系符合现有恢复契约。

**交付给 AI 0**：资产入口、稳定 ID、有效操作/支撑区域、验证结果及接入说明。

---

### AI 2：导航与空间可达性——先一楼，再上下楼

**负责范围**：

```text
modules/world/runtime/systems/NavigationSystem.js
modules/world/runtime/systems/LocomotionSystem.js
modules/world/runtime/navigation/**
modules/world/content/magic-cabin/**            仅通过迁移脚本或宿主适配器修改，见第 5 节
tests/world/navigation-*, locomotion-*, magic-cabin.test.js
```

不修改资产语义、Agent 提示或渲染材质。

任务：

1. 优先验证一楼路径：屋外到房门 / 房门到任务文本 / 柜前操作区域 / 柜子到桌面 / 灯的可操作位置。
2. 使用现有默认 Agent 尺寸，核实其碰撞体、站立高度、步高与转弯空间。
3. 目标位置不能直接等同于物体中心；提供可站立、可接近的交互区域。
4. 验证开关门后导航输入与可达性能更新。
5. 一楼闭环稳定后，调整旋转楼梯及楼板开口，使默认 Agent 能真实上下楼。
6. 优先调整碰撞/通行代理，不以缩小 Agent 或瞬移绕过问题。

**验收**：

- 使用真实 Recast 路径与生产角色碰撞控制器。
- 一楼各任务位置可达，角色不会穿过关闭的门或家具。
- 上楼、下楼均完成真实角色穿行；含中途受阻情况。
- 加入障碍后能正确判定阻断。
- 若使用导航连接，必须对应角色实际可执行的运动，不能只是路径图上的连线。
- 若本轮未达成跨层通行，允许以「部分达成 + 明确剩余限制」结项，但不得宣称已通。

**交付给 AI 0**：可达区域、几何变更、角色参数假设与路径测试入口。

---

### AI 3：渲染与性能——建立证据，再优化

**负责范围**：

```text
modules/world/runtime/systems/RenderingSystem.js
modules/rendering/**
apps/studio/ui/developer/DeveloperSettings.js
apps/studio/style.css
apps/observatory/labs/physics/PhysicsLab.js（仅渲染相关诊断）
dev/scripts/benchmark-cabin.mjs
tests/rendering/**
```

不修改交互语义、物理判定或导航规则。

**第一阶段：诊断**（分别统计，不得把其中某一项当作完整帧成本）

```text
场景内容更新 CPU
物理与导航成本
渲染提交 CPU
实际可获取的 GPU 耗时
帧间隔 P50/P95
draw calls / 三角形 / 几何体 / 纹理数量
```

**第二阶段：优化**（依据测量结果选择）

```text
静态几何合批
重复物件实例化
材质与纹理复用
阴影范围、分辨率与投射物件控制
减少无变化对象的动画与矩阵更新
避免不必要的导航重建
```

保持线稿小屋风格，重点处理空间层次、室内光照、材质可读性与灯光状态响应。

**验收**：

- 优化前后使用同场景、同视角、同设备与分辨率。
- 静止观察、移动穿行、多物件动画分别记录。
- 合批或实例化不能破坏对象 ID、拾取、遮挡、碰撞与剖面功能。
- 提供可关闭的优化选项或可复现对照方式。
- **没有真实浏览器/GPU 数据时，提交测量设施与待人工采样步骤，明确「尚未性能验收」。**
- GPU 时间只在后端真的提供时记录，未知留空，不得填推算值。
- `dev/scripts/benchmark-cabin.mjs` 只测内容更新 CPU，排除渲染、物理与导航；**禁止**用它推算或宣称 FPS，禁止用「内容更新 CPU 耗时」冒充帧时间。
- 不宣称画质或效率超过 Blender，除非确实完成可解释的同条件比较。
- 目标预算：主视角 P95 ≤ 20 ms（当前未验收）。

**人机分工（本阶段 AI 无法独立完成）**：

- AI 交付：插桩 + headless 数据 + 显式未测标记。
- 人类负责：在有真实 GPU 的机器上打开 `?world=magic-cabin`，用 DeveloperSettings 读取数据并回贴。

**交付给 AI 0**：可独立接入的渲染改动、基准结果、未测项与回归风险。

---

### AI 4：Studio 上下文交互——消费现有契约

**启动条件**：AI 0 已确定交互接口；之前可先检查现有 UI 与设计组件结构。

**负责范围**：

```text
apps/studio/ui/WorldInteraction.js
apps/studio/ui/WorldContext.js
apps/studio/ui/HumanViewController.js
apps/studio/editor/AssetPlacementController.js
tests/studio/world-interaction.test.js
tests/studio/human-view-controller.test.js
```

不修改 Runtime 行为、资产状态或物理规则。

任务：

1. 点击对象显示真实可用动作，不能仅按物件名称猜按钮。
2. 显示动作阻断原因，例如 `OUT_OF_REACH` / `OCCLUDED` / `WARDROBE_DOORS_MUST_BE_OPEN`。
3. 展示 pending、完成、失败与未验证状态。
4. 明确区分：编辑模式允许远程编辑（`editor:true` 通路）；体验/Agent 模式遵守具身约束。
5. Inspect 原地显示资产、碰撞、状态、空间关系与证据类型。
6. 重用现有视图与选择机制，避免再建一套拾取或对象状态。
7. 世界内生成仅先接入已有管线；若需要新增后端能力，另列任务，不挤占当前物理闭环。

**验收**：

- UI 展示与 Runtime 返回一致。
- 不用本地 UI 状态提前宣布成功。
- 模式切换不会绕过权限或具身检查。
- 不阻断已有相机控制、对象选择与文字编辑。
- 无浏览器验证时，明确交付的是代码与组件测试结果，视觉验收待完成。

**交付给 AI 0**：组件、输入输出接口、接入位置与测试结果。

---

## 5. 改动落点规则（新增，必须遵守）

`modules/world/content/magic-cabin/cabinContents.js` 是**生成物**（406 KB / 7069 行），由 `dev/scripts/migrate-magic-cabin.py` 从源 HTML 抽取并变换而来。重跑迁移会覆盖直接编辑的内容。

```text
几何 / 结构改动   → 在 dev/scripts/migrate-magic-cabin.py 中增加变换，然后重跑迁移
碰撞 / 通行代理   → 在 modules/world/content/magicCabin.js 宿主层覆盖
                    （内容层已返回 architectureRoots / platformBoxes /
                     movingPlatforms / colliders，宿主可直接覆盖代理）

禁止：直接编辑 modules/world/content/magic-cabin/cabinContents.js
禁止：修改 D:\a_programming_list\A-Python-Project\wk08\web-012-line-art-style-magic-cabin\index.html
禁止：修改迁移来源标记与源文件 SHA-256 记录

优先顺序：碰撞代理 > 几何变换。能用代理解决的不要动几何。
```

迁移脚本已有的变换范例（楼梯改造应加同形态变换）：

```python
body = body.replace('scene.add(buildStairs());',
                    'const stairs = buildStairs(); scene.add(stairs); architectureRoots.push(stairs);')
```

另外脚本内有 `labels` 字典，用于给源变量名补中文交互标签（例如 `'lanternPivot':'点亮 / 熄灭木灯'`、`'storageChest':'打开楼梯下储物箱'`）。新增或改名交互对象时需同步维护。

两类改动都必须在交付说明里写明：改了什么、为何必须改、是否影响原作观感。

---

## 6. 执行顺序与最终交付

```text
阶段 0：基线冻结（全部 AI 之前）
        ↓
AI 0：确定共享契约、对象清单、读取任务改法
        ↓
   ┌────────────┬────────────┐
   AI 1         AI 2         AI 3
   资产物理      导航空间      渲染诊断
   └─────┬──────┴────────────┘
         ↓
   AI 0：一楼任务集成
         ↓
   AI 4：上下文 UI
         ↓
   AI 0：最终验收
```

**第一里程碑只验收「一楼完整具身任务」。** 上下楼与渲染优化可以并行推进，但不能拖延这一闭环，也不能用它们的局部成果替代任务成功。

**串行约束**：阶段 1 与阶段 2 都改 magic-cabin 内容，必须串行，不得并行。阶段 3 与阶段 1/2 无文件冲突，可在阶段 2 之后并行启动。

### 每轮交付物（缺一不可）

1. 代码改动
2. `npm run check` 完整输出（必须全绿）
3. 可复现入口命令
4. 剩余限制清单
5. 显式未测项（写了「未测」就必须真的没测，不得用推算代替）
6. 任务登记到就近 `tasks.jsonl`
7. `docs/world-first-direction.md` 同步更新

### 最终报告必须分开列出

```text
已实现且通过验证
已实现但尚未实测
尚未完成
已知失败及复现方法
```

不要用一个笼统的「完成度百分比」代替这些结果。

---

## 7. 仓库门禁与禁止项

### 门禁

```text
npm run check
  → architecture:validate  (dev/validate-repository-architecture.mjs
                            dev/validate-domain-boundaries.mjs
                            dev/validate-convergence.mjs
                            npm run planning:validate)
  → assets:validate
  → world:viability
  → typecheck
  → test
  → build
```

`npm run check` 是唯一交付门禁。不跑等于没交付。

### git 安全，硬约束

```text
禁止执行：git stash / git checkout -- . / git clean -fd / git reset --hard /
          git commit -a / 任何对第 2 节所列文件的覆盖
开工前先 git status 记录基线；每轮结束前 git diff --stat 留档
```

### 永久禁止项

```text
不新增 Manager / Registry / Controller 横向层（dev/validate-convergence.mjs 会主动拒绝）
产品代码不得 import apps/observatory/**
不为行数拆 InteractionSystem.js(69KB) / PhysicsSystem.js(65KB)
不修改 web-012-line-art-style-magic-cabin/index.html
不修改迁移来源标记与源文件 SHA-256 记录
不新增后台页面；不把装饰点击数当 Agent 能力指标
不把「测试绿」当作交付完成
```

---

## 8. 文档同步（每轮结束后）

更新 `docs/world-first-direction.md`：

- 「当前已落地」段落补齐本轮成果
- P0/P1/P2 表格中对应项的状态与验收结论
- 「当前证据边界」段落更新（哪些是真实 Runtime，哪些仍是桩，哪些未测）

理由：该文档是其他 AI 的「唯一优先级依据」，不同步等于下一轮会基于过时判断开工。

---

## 9. AI 0 的三道判断题 — 已核实答案（2026-09-16）

### 9.1 `createMagicCabin` 接 `environmentFactory` —— 不需要任何适配

`createMagicCabin()`（`modules/world/content/magicCabin.js`）返回的对象已满足 `WorldRuntime.installEnvironment` 的全部要求：

```text
返回字段：id / root / floor / colliders / layout / camera / rendering /
        interactions / affordances / setCamera / views / catalog /
        storageKey / setCutaway / snapshot / validateSnapshot / restore /
        diagnostics / step / dispose

installEnvironment 校验：root.isObject3D = true（content.root，name='MagicCabin'）
                       Array.isArray(colliders) = true（architectureRoots 的 trimesh
                       + platformBoxes 的 box + moving 门窗/平台）

调用链：environments.js load() → apps/studio/main.js:67 environmentFactory
        → :75 createSession({environmentFactory}) → WorldRuntime.addEnvironment
```

结论：**无需改适配**。此前的担心（`cabinContents` 返回 `root: scene`）不成立——`magicCabin.js` 宿主层已经把 `content.root` 暴露为 `root`。

### 9.2 资产方案 —— 方案 (a) 已经在仓库里实现了

`modules/world/content/environments.js` 的 magic-cabin 条目已带落位配置：

```text
bootstrap:{agent:[6,0,-5], table:[7,0,2], cabinet:[7,0,5], cup:[7.35,1.4,2]}
coffeeCorner:{table:[7,0,2], cabinet:[7,0,5]}
```

`modules/agent/bootstrapWorld.js` 会按此 spawn `agent_01 / table_01 / cabinet_01 / cup_01`，
由 `apps/studio/main.js:257,270` 与 `apps/studio/ui/bindSceneControls.js:39` 调用。

所以「往屋里搬一套标准资产」这一步**已完成**，不需要在 (a)/(b)/(c) 之间决策。
剩下的**唯一资产侧改动**：`bootstrap.cup` 目前放在**桌面**上（`[7.35,1.4,2]`，table 在 `[7,0,2]`），
而任务要求「从柜中取杯」，需要把 cup 起点改到柜内：

```text
cabinet 位于 [7,0,5]，receptacle interior localPosition [0,0.975,-0.01]
柜体底面 collider 顶面 y = 0.10；cup 碰撞体为 cylinder halfHeight .16、translation [0,0.16,0]
→ 建议 cup:[7,0.16,4.99]（略高于落点，靠 settle 稳定）
```

另注：`coffeeCorner` 在 `**/*.js` 范围内**未发现消费者**，疑似遗留配置，需 AI 0 确认删除或接线。

### 9.3 「读取任务」——选 β，且实现不必动迁移脚本

现状（已核实）：一楼**没有任何 text 契约**。`texts` 只有 `cabin:sign`（屋外路牌）与 `cabin:note-N`（**二楼**计划板便签）。
二楼坐标证据：`boardG.position.set(-2.9, FY, 2.8)`，`const FY = FLOOR_TOP = 3.12`。

推荐 **β**：在一楼新增一个任务文本契约。落点选宿主层，不要动生成的 `cabinContents.js`：

```text
在 modules/world/content/magicCabin.js 中向 content.affordances 追加一个 text 契约：
  object：宿主新建的 THREE.Object3D，挂到 root 的一楼餐桌附近
  get/set：宿主级变量（不依赖 content.textState）
  同时把它纳入 environment.snapshot() / validateSnapshot() / restore()
  （现有 schemaVersion 仍为 1，新增字段需同步 validateSnapshot）
```

要点：这是**宿主扩展**，不是迁移内容，交付说明必须分开标注；原作者署名与源文件 SHA-256 不变。
若 AI 0 改选 α，则链路变为「读屋外路牌 → 开门 → …」，必须在文档中明确记录该降级。

### 9.4 阶段 2 楼梯 —— 改几何参数，不加代理，也不动公共阈值

实测参数：

```text
FLOOR_TOP = 3.12            STAIR_N = 14
stepH = 3.12 / (14+1) = 0.208 m
rI = 0.14   rO = 1.10       HOLE_R = 1.20   RAIL_R = 1.24
rPost = rO - 0.07 = 1.03    dTheta = 270/14 ≈ 19.29°
栏杆柱：每个踏步一根，位于 r = 1.03，半径 0.02，间距约 1.03 × 0.337 ≈ 0.35 m
```

导航与角色阈值：

```text
NavigationSystem DEFAULT_CONFIG: agentRadius 0.3 / agentHeight 1.7 / maxClimb 0.3 /
                                 maxSlope 45 / maxSnapDistance 0.75 / endTolerance 0.3
RecastNavigationBackend tuning:  cellSize 0.15 / cellHeight 0.1
  → walkableClimb  = voxelFloor(0.3, 0.1) = 3 voxels = 0.30 m
  → walkableRadius = voxelCeil(0.3, 0.15) = 2 cells  = 0.30 m
Rapier character controller: autostepHeight 0.3 / autostepMinWidth 0.2 / snapToGround 0.3
                             （Jolt 镜像同一组参数）
```

### 已实测结论（2026-09-16，只读探针）

复现入口：

```bash
node dev/scripts/probe-cabin-stairs.mjs
```

该脚本复用 `tests/world/magic-cabin.test.js` 的夹具，不改源码、不改仓库状态。

**仍然成立的结论：**

- `stepH = 0.208 ≤ 0.30`，**踏步高本身不是瓶颈**；Rapier `autostepHeight = 0.3` 也够。
- 因此**不要**提高 `maxClimb` 或 `autostepHeight`——它们是 5 个世界共用的阈值，为一个世界改会破坏其他世界的一致性。

**已实测的可达性（buildVersion 2，关门状态下重建过一次）：**

```text
outside -> 1F-inside (door closed)   blocked  PARTIAL_PATH
outside -> 1F-inside (door open)     REACHABLE cost 10.308  wp 6
1F-inside -> stair-bottom            REACHABLE cost  5.449  wp 6
1F-inside -> stair-mid(k7)           blocked  END_OFF_NAVMESH   snap 1.748 -> [−0.376, 0.178, −1.462]
1F-inside -> stair-upperMid(k10)     blocked  END_OFF_NAVMESH   snap 1.297 -> [−1.017, 3.190, −1.087]
1F-inside -> stair-top(k13)          blocked  PARTIAL_PATH      cost 5.032  wp 5
stair-mid(k7) -> stair-top(k13)      blocked  START_OFF_NAVMESH snap 1.748
stair-top(k13) -> 2F                 REACHABLE cost  2.450  wp 4
stair-topInner(r .35) -> 2F          REACHABLE cost  2.463  wp 4
2F -> stair-top(k13)                 REACHABLE cost  2.450  wp 4
1F-inside -> 2F                      blocked  PARTIAL_PATH
2F -> 1F-inside                      blocked  PARTIAL_PATH
```

**navMesh 高度分布（180 个三角形，×0.25 m 分桶）：**

```json
{"0.00":122,"0.25":6,"0.50":2,"0.75":4,"3.25":38,"5.50":4,"6.00":4}
```

楼梯足迹内（`r ≤ 1.6`）14 个三角形：`{0.00:7, 0.25:2, 3.25:5}`，`minY 0.09 / maxY 3.19`。

**由此得到的关键事实：**

1. **y ≈ 0.75 → 3.25 之间根本没有任何 navmesh。** 螺旋楼梯中段（约第 4 阶以上）在烘焙结果里完全不存在，而不是“被腐蚀变窄”。
2. **上一版写的「`2F ↔ stair-top` 双向可达，所以楼梯顶与二楼连通」是错的，现已推翻。**
   成功分支的返回体带 `start.snapDistance` / `end.snapDistance`，上一版汇总漏读了这两个字段。
   所有阶梯顶相关的 REACHABLE 实际都是**吸附**，不是连通：
   `stair-top -> 2F` startSnap 0.420；`stair-topOuter` 0.565；`stair-topInner` 0.415；`2F -> stair-top` endSnap 0.420。
   阈值 `maxSnapDistance = 0.75`，所以 0.42 被静默接受。**踏步顶同样不在 navmesh 上。**
3. 因此 `1F ↔ 2F` 双向都是 `PARTIAL_PATH`——两个岛屿，楼梯没有接上任何一阶。

**原假设已被实证否证（必须删除）：**

> 原假设：“栏杆柱间距 0.35 m，叠加 `walkableRadius = 0.30 m` 腐蚀形成环形屏障”。

A/B 检验：把 23 个栏杆节点（4 个 `TubeGeometry` 扶手管 + 19 个 `radiusTop=0.02` 栏杆柱）
标记为 `navigationIgnore` 后重新烘焙：

```text
三角形  180 -> 179       楼梯足迹内三角形  14 -> 13
高度分布 完全不变（仅 3.25 档少 1）
所有跨层/跨楼梯用例的 reason 与 snapDistance 完全不变
```

**栏杆不是原因。该假设作废，不要沿着它改几何。**

### 已否证的原因（逐条实测，不得再沿用）

| # | 假设 | 检验方式 | 结果 |
|---|---|---|---|
| 1 | 栏杆柱腐蚀形成环形屏障 | 23 个栏杆节点标记 `navigationIgnore` 后重烘 | **否证**：三角形 180→179，楼梯足迹 14→13，高度分布与所有用例 reason 一字不变 |
| 2 | 踏步高 0.208 超过 `maxClimb` | 参数比对 | **否证**：0.208 ≤ 0.30 |
| 3 | `walkableHeight = 1.7 m` 净空不够 | Rapier 竖直射线，逐阶 ×3 半径 | **否证**：第 2–10 阶上方 4 m 内没有任何实体 |

净空射线实测（起点在踏步面上方 0.05 m，向上 4 m，需求 1.7 m）：

```text
step 0  y=0.208   命中 2.802  ← 上方是二楼楼板
step 1  y=0.416   命中 2.594  ← 上方是二楼楼板
step 2  y=0.624   4 m 内无实体
step 3  y=0.832   4 m 内无实体
step 4  y=1.040   4 m 内无实体
step 5  y=1.248   4 m 内无实体
step 6  y=1.456   4 m 内无实体
step 7  y=1.664   4 m 内无实体
step 8  y=1.872   4 m 内无实体
step 9  y=2.080   4 m 内无实体
step10  y=2.288   仅 r0.9 命中 3.950
step11  y=2.496   3.933 / 3.814 / 3.672
step12  y=2.704   3.716 / 3.591 / 3.441
step13  y=2.912   3.519 / 3.402 / 3.261
```

楼梯中段处在一个**竖向贯通的中庭**里，净空充足。净空需求满足的阶梯（2–10）恰恰没有 navmesh，
而净空较小的阶梯（0–1）反而在 navmesh 里。

### 调参无法修好：三个方向都试过了

`NavigationSystem` 接受 `config` 覆盖，`RecastNavigationBackend` 接受 `{cellSize, cellHeight, tileSize, maxObstacles}`。
分别重烘并重新查询：

| 变体 | 派生阈值 | 中段 navmesh | `mid(k7) -> top(k13)` | `1F ↔ 2F` |
|---|---|---|---|---|
| 基线 | radius 2 格 = 0.30 m，climb 3 格 | 无 | `START_OFF_NAVMESH` | PARTIAL_PATH 双向 |
| `cellSize .08 / cellHeight .05` | radius 4 格 = 0.32 m | 1.25/1.50/2.25/2.50/3.00 各 **1 个**三角形 | PARTIAL_PATH（wp 2） | PARTIAL_PATH 双向 |
| `agentRadius 0.15` | radius **1 格** = 0.15 m | 1.25:5 / 1.50:1 / 2.25:1 / 2.75:1 | PARTIAL_PATH（wp 1） | PARTIAL_PATH 双向 |
| `maxClimb 1.0` | climb **10 格** | 0.75/1.00/1.50/2.00/2.25/3.00 各 **1 个**三角形 | PARTIAL_PATH（wp 3） | PARTIAL_PATH 双向 |

**三个方向（更细体素、更小半径、更大爬升）都无法把楼梯连成一条可走带。**
中段无论怎么调都只出现**每个高度层级 1 个孤立三角形**，从来不是连续带。

- 这**推翻了“阶段 2 可能只是改一个参数”的旧判断**。已实测：它不是参数问题。
- `maxClimb 1.0` 时 `1F-inside -> stair-mid(k7)` 变成 REACHABLE，说明踏步**部分**被栅格化了；
  它们只是没形成连续区域，且那次 `startSnap = 0.417`，仍带吸附成分。

### 隔离烘焙已完成：阻断在踏步几何本身，不在房屋

把楼梯单独烘焙（去掉整栋房子），用两个互相独立的样本各跑一次：

| 样本 | 基线参数 | `maxClimb = 1.0` |
|---|---|---|
| 合成楼梯（按同尺寸重建 14 个梯形踏步） | **`NAVMESH_EMPTY`，0 个三角形** | 4 个三角形（1.25/2.00/2.25/2.50），可达完全靠 0.62/0.28 吸附 |
| **真实楼梯分组**（30 个网格全部采集到：14 踏步 + 14 栏杆柱 + 中柱 + 扶手管） | **`NAVMESH_EMPTY`，0 个三角形** | 2 个三角形（1.00/1.50），三个查询全部 blocked |
| 整栋小屋（对照） | 180 个三角形，楼梯中段无 navmesh | — |

**结论：楼梯单独存在时，烘焙结果是空的 —— 一个三角形都没有。**
两个独立样本（重建的与真实的）给出同一结果，所以：

> **阻断在踏步几何本身，不在周围建筑。**

并且 `maxClimb` 放大到 1.0 也只能凑出 3–4 个孤立三角形，且每一步都靠吸附。
**相邻踏步也没有合并成连续带。**

与解析上界合在一起，整条链现在自洽且完整：

1. 单个踏步内切圆半径 **0.146 m < 0.30 m** → 孤立踏步在数学上不可能承载可走单元。
2. 相邻踏步合并也没发生（实测 0 → 3–4 个散三角，从不成带）。
3. 因此螺旋楼梯在 `agentRadius = 0.30 m` 下**不可表示**，无论房屋是否存在、无论如何调参。

### 阶段 2 的定性（已确定）

- **阶段 2 是几何重设计任务，不是参数任务。** 这一点现在有实测支撑，不再是推测。
- 几何修法的方向（由上述结论直接推出）：当前两条路必须至少走通一条：
  - **单个踏步不再可行**（需内切半径 ≥ 0.30 m，即切向宽度 ≥ 0.60 m，而当前最大弧宽只有 0.341 m）；
  - 或让相邻踏步**真正合并成一条带**，且带在径向宽度上 ≥ 0.60 m。
  可选做法：加大切向角宽（缩小 `STAIR_N` 或放大 `treadHalf`）、加大径向宽度，
  或改用带平台的直跑／折跑楼梯。

### 几何扫描：找到可行解，并检验了解析判据

把 6 组候选几何各自重建、各自单独烘焙，条件完全对等：

| 候选 | 切向半角 | 外缘切向半宽 | 解析内切半径 | 烘焙三角形 | 最底 → 最顶 |
|---|---|---|---|---|---|
| 按现状 | 8.871° | 0.170 | **0.146** | **0** | `NAVMESH_EMPTY` |
| 只闭合相邻缝隙 | 10.029° | 0.192 | 0.162 | **0** | `NAVMESH_EMPTY` |
| 扫掠改 360° | 13.371° | 0.254 | 0.205 | **0** | `NAVMESH_EMPTY` |
| 步数改 N=11 | 12.764° | 0.276 | 0.225 | 1 | `OFF_NAVMESH` |
| 加宽径向（到 1.40） | 10.029° | 0.244 | 0.206 | **0** | `NAVMESH_EMPTY` |
| **组合：360° / N=11 / 径向 0.08→1.40** | **17.018°** | **0.410** | **0.315** | **12** | **全部 REACHABLE** |

**解析内切半径 0.30 m 是一条真实的分界：** 它以下的 5 组全部是 0～1 个三角形，
唯一越过它的组合拿到了 **12 个三角形、高度分布覆盖 0.50 → 2.75**（正是原来完全缺失的那一段），
三个查询全部可达（吸附 0.321 / 0.201 / 0.153）。

所以有了一个判据。**注意：上一版这里写的 `radiusOuter · sin(halfAngle) ≥ 0.30` 是错的，已改正。**
它只看了外弧切向半宽，漏了踏步到外弧的距离，两者取小值才是限制项：

```text
max over r of  min( r·sin(halfAngle),  radiusOuter − r,  r − radiusInner )  ≥  agentRadius
其中 halfAngle = sweepDeg / stairN × overlapFactor
```

即切向半宽与到外弧的距离在 **r = radiusOuter / (1 + sin(halfAngle))** 处平衡，那里取得最大内切圆。

这个改正后的公式对三个实例都预测正确（不是拟合）：

| 实例 | halfAngle | radiusOuter | 公式算得 | 实测 |
|---|---|---|---|---|
| 按现状 | 8.871° | 1.10 | **0.147** | 0 个三角形 |
| 隔离的 `combined` | 17.018° | 1.40 | **0.317** | 12 个三角形，连通 |
| 只改楼梯、保留 rO=1.10 | 17.018° | 1.10 | **0.249** | 无中段 navmesh（见下） |

- 附带约束：`riser = FLOOR_TOP / (stairN + 1) ≤ maxClimb = 0.30 m`，所以 `stairN ≥ 11`。

### 必须记录的一个探针 bug（已修复）

早先那段“排除栏杆”的 A/B 把 23 个节点的 `userData.navigationIgnore` 设为 `true` 后**没有还原**，
导致其后每一轮隔离烘焙都在“栏杆被排除”的状态下运行 —— 真实楼梯只采集到 **15/30** 个网格，
而 `skipped` 是空的（`navigationIgnore` 在入 skipped 之前就 `return`），所以看不出异常。

已修为：A/B 前快照原值、A/B 后还原（`flagsRestored = 23`），并在失败时直接调用
`NavigationSystem.collectStaticMeshes()` 核对采集数与几何类型分布，现在是
`CylinderGeometry 15 + ExtrudeGeometry 14 + TubeGeometry 1 = 30`。

**结论未受影响**（14 个踏步始终都在采集中，缺的只是已被单独证明无关的栏杆），
但上一版 brief 里“真实分组 3 个三角形”那行已按修复后的数据更正为 2 个。

### 改动落点

场景图里楼梯是一个**顶层分组**，特征为 `meshes = 30 / extrudeMeshes = 14`，
全屋共 1740 个网格、26 个 `ExtrudeGeometry`，只有这一个分组满足该特征。
它没有名字，但按这个特征可稳定识别。修改应走迁移脚本，**不要**改烘焙阈值（阈值是 5 个世界共用的）。

### 就地验证（在真实小屋内重建楼梯）：**失败**，并借此推出新约束

做法：在内存中用新参数重建整组楼梯（踏步 + 扶手柱 + 扶手管 + 中柱），替换 `cabin.root` 里那组，
再对**整栋小屋**重烘并查询。仓库源码零改动（仅在内存里换对象）。
故意保留的唯一约束：`radiusOuter = 1.10` 不变，以免碰到二楼开口（`HOLE_R = 1.20`）。

结果（`stairN 11 / sweep 360° / overlap 0.52`，公式算得 0.249）：

```text
replacementApplied = true
高度分布 0.00:119  0.25:11  0.50:2  0.75:4  3.25:38  5.50:4  6.00:4     三角形 182
1.00 / 1.25 / 1.50 / 1.75 / 2.00 / 2.25 / 2.50 全部为 0   ← 中段仍无 navmesh
1F-inside -> 2F                 blocked  PARTIAL_PATH
1F-inside -> stair-mid(k5)      blocked  END_OFF_NAVMESH
stair-mid(k5) -> stair-top(k10) blocked  START_OFF_NAVMESH
```

**公式预测的 0.249 < 0.30 是对的，实测就是失败。**（另：`outside -> 1F-inside` 仍 REACHABLE，说明替换本身生效了。）

### 由此推出的硬约束：**只改楼梯修不好**

在 `radiusOuter = 1.10` 下，判据要求 `1.10·s / (1+s) ≥ 0.30` → `s ≥ 0.375` → `halfAngle ≥ 22.0°`。
而 `halfAngle = overlapFactor · sweep / stairN`：取 overlap 0.5、sweep 360° 时需要 `N ≤ 8`；
但 `riser ≤ 0.30 m` 要求 `N ≥ 10`。**两者矛盾。**

所以 **`radiusOuter` 必须放大，也就必须放大二楼开口。** 反解所需半径
（overlap 0.52 / sweep 360° / N=11，`s = 0.2927`）：

```text
radiusOuter ≥ agentRadius · (1 + s) / s = 0.30 · 1.2927 / 0.2927 = 1.325 m
```

取 `radiusOuter = 1.40` 需要 `HOLE_R` 从 1.20 提到约 **1.55**，并连带牵动：

| 位置 | 当前值 | 为何要改 |
|---|---|---|
| `HOLE_R` | 1.20 | 楼板挖孔变大 |
| 装饰环 `TorusGeometry(HOLE_R, 0.04, …)` | 1.20 | 随孔改 |
| 扇形平台 `landingShape`（30°–150°，半径 = `HOLE_R`） | 1.20 | 随孔改；且楼梯改成 360° 扫掠后会**与它重叠** |
| 栏杆 `RAIL_R` | 1.24 | 随孔外移 |
| 楼板梁 `avoidR = HOLE_R + 0.05` | 1.25 | 随孔改 |

### 迁移管线：当前跑不了（环境缺 Python）

- `modules/world/content/magic-cabin/cabinContents.js` 是**生成产物**
  （头部：`Generated by dev/scripts/migrate-magic-cabin.py`），**不得手改**。
- 生成器输入在**仓库之外**：`wk08/web-012-line-art-style-magic-cabin/index.html`（572,761 字节，存在）。
- 这台机器上**没有可用的 Python**：`py` 启动器指向已不存在的 `Python311`；
  `WindowsApps\python.exe` 垫片返回 9009；conda 只剩缓存目录。
- 因此 `migrate-magic-cabin.py` 无法执行，`cabinContents.js` 无法重新生成。
  所以本轮**未改动任何源码**，探针里的重建全程在内存中完成。
- 另记一笔：`dev/validate-convergence.mjs` **不校验**生成文件与迁移的一致性
  （它只查退役表面、边界、包脚本等），所以“生成产物可复现”目前只是约定，不是门禁。

### 修正上一版的建议

上一版把“加大径向宽度”与“缩小 `STAIR_N` / 放大切向角宽”并列为可选项。
**实测表明径向加宽是必需项而非可选项**，并且它会把改动范围从楼梯本身扩展到二楼楼板。

- 阶段 1 不受影响：`outside -> 1F-inside` 关门阻断 / 开门可达均已复现，可继续推进。
