# 外部资产交互化（V2-PR-12）

普通 GLB 先作为候选分析，审核物理参数后再编译、隔离验证和注册。物理代理通过检查后，场景中的实际操作仍由现有 `scene.interact()` 执行和验证。没有新增编译流水线或按物体分类的 Agent 技能。

## SDK

```js
const source = { kind: 'glb', bytes, name: 'external-box.glb' };
const proposal = await scene.prepareAsset(source);
// proposal 不注册资产，也不赋予执行权限。
// physics.body / mass / friction 为 null；不能把模型名称当作物理事实。

const review = {
  proposalId: proposal.proposalId,
  confirmed: true,
  physics: { body: 'dynamic', mass: 2, friction: 0.5 },
  parts: []
};
await scene.addModel({
  id: 'external_box', asset: { ...source, review },
  position: [0.65, 0, 0]
});
const capabilities = scene.inspect('external_box', { actor: 'agent_01' });
const job = scene.interact({ actor: 'agent_01', target: 'external_box',
  action: 'push', args: { direction: [1, 0, 0], distance: 1 } });
const completed = await scene.waitJob(job.id); // 宿主必须推进模拟
```

示例中的质量和摩擦是审核者选定的参数，不是从 GLB 测量得出的真实材质属性。实际站位、距离、碰撞或力不足仍可能使任务失败，应检查 Job 的终态和验证证据。

审核契约由 `interactionReviewSchema` 统一约束：必须确认 proposalId、刚体类型、正质量和摩擦。移动部件还必须确认唯一的 id / node、parent、部件物理参数、关节类型、非零轴、两个锚点及包含 GLB 零位的限位。电机参数可调整，默认 stiffness=80、damping=12。支持 box 碰撞体覆盖；省略 colliders 时复用现有几何 Pass 生成的代理。

## 既有 Pass 与证据

| 环节 | 复用实现 | 证据边界 |
| --- | --- | --- |
| 几何与命名分析 | GLTFInspectPass、SemanticHeuristicPass、ArticulationCandidatePass | 命名/元数据置信度只用于候选，不证明机械结构；轴和锚点缺失时不猜测 |
| 关节坐标与碰撞 | JointFramePass、PartColliderPass、ArticulatedCollisionPass | URDF 需要节点和坐标帧兼容；根与部件碰撞体按网格归属生成，避免用整件包围盒阻挡自己的活动部件 |
| 审核、优化与质量 | PartProposalPass、ExplicitDefinitionPass、OptimizeGLBPass、CompileQualityPass、ManifestPass | 审核后的粗碰撞体是被接受的代理，不等于精确 Mesh；结构和资源质量检查仍保留 |
| 隔离物理验证 | 既有 ArticulationVerifier | 动态刚体检查注册、碰撞体和冲量后的实际运动；数值关节检查到达、运动、限位、沿途碰撞及返回零位 |
| 世界执行 | 既有 InteractionSystem、Scene Job | 独立验证实际位移/关节状态、可达性和取消；不把导入成功当作世界任务成功 |

候选始终返回 executable=false、physicsVerified=false、missing 和来源证据。源文件、审核参数或候选变化后，旧 proposalId 不能复用。客户端不能提交 verification 字段或伪造运行时结果。

注册前才运行隔离验证；失败候选不进入注册表或 ObjectStore。编译资产中的旋转/滑动关节即使未声明 open/close，也必须满足运行时准入，才能使用 slide / rotateJoint；语义 open/close 不得绕过此限制。重新导入项目包时重新验证关节，不复用历史“成功”声明。

语义分类不确定时，整体准入仍可为 provisional，而 runtime 层为 ready；两者必须分别报告。隔离验证只证明所审核物理代理的兼容性，不证明制冷、工具用途、抓取点或手指接触。

## URDF

`source.urdfBytes` 可附带与 GLB 对应的 URDF。它复用已配置 Compiler Provider 的 `urdf-proposal` 上传入口及现有 Python/yourdfpy 解析，再通过 JointFramePass 和 PartColliderPass。提供方不可用时返回 URDF_PROVIDER_UNAVAILABLE，不静默编造结果。GLB 上限 32 MiB，URDF 上限 1 MiB。

本阶段要求 GLB 提供配套几何；不会根据 URDF 中的外部 mesh 路径自动下载或生成模型。无法唯一对应的节点、缺失限位或不兼容坐标帧会保留为缺失项/诊断，必须修正审核参数后再验证。URDF 的 continuous 关节需审核为有限位的 revolute 代理，才可进入当前受约束操作路径。

## MCP

继续使用 `scene_add_model`：`mode: "prepare"` 返回候选，`mode: "add"`（默认）审核导入并加入场景。两者的 model.asset 都可为 `{ kind: "glb", name, bytesBase64, urdfBase64? }`；add 时再附带 review。之后仍用 `scene_observe`、`scene_interact` 和 `scene_job`。

传输只接受规范 Base64，不接受 URL 或客户端 verification。MCP 的 HTTP 请求大小继续受宿主 `security.maxBody` 约束（默认 64 KiB），大文件需要部署者显式配置适当配额；SDK / Studio 直接使用 Uint8Array。

## Studio 与验收

“运行时设置 → 资产编译 → 分析可交互能力”可上传 GLB 和可选 URDF，查看候选、置信来源、缺失项和碰撞代理，编辑审核 JSON。填齐参数并勾选确认后，“验证并注册到资产库”复用同一资产入口。更换文件会使旧审核失效。

- `tests/integration/asset-interaction-pipeline.test.js`：新箱子、抽屉、阀门 GLB；URDF 适配器接入；过期审核、伪造证据、错误锚点和未验证关节拦截。
- `tests/mcp/scene-api.test.js`：真实 HTTP MCP 客户端完成 GLB 候选、审核导入、推动一米及证据查询。
- `tests/browser/asset-import.spec.js`：真实 Studio 文件上传、未确认拦截、参数修改、物理验证注册及更换文件失效。

上述样本是运行时生成的未知 GLB 测试模型；不是对第三方商店模型的在线下载或兼容性声明。PR-09 的真人首次使用验收仍单独保留，自动化测试不能替代它。
