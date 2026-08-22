# 资产编译器研究记录

在实现 AgentScape Asset Compiler 前，实际拉取并用 CodeGraph 阅读了以下仓库。

| 项目 | 许可证 | 采用方式 |
| --- | --- | --- |
| allenai/objathor | Apache-2.0 | 学习分阶段资产转换与 simulator validation |
| SarahWeiii/CoACD | MIT | 作为可选重型碰撞后端 |
| donmccurdy/glTF-Transform | MIT | 直接作为 npm 依赖复用 |
| vlongle/articulate-anything | 未发现许可证 | 只学习 articulation 验证闭环，不复制源码 |

## ObjaTHOR 的关键启发

真正的资产转换不是格式转换，而是连续处理：尺度/朝向、几何清理、碰撞、annotation、可见性和最终 simulator 验证。AgentScape 采用同样的“分 Pass”思路，但目标运行时是浏览器。

## CoACD 的关键启发

碰撞几何属于编译产物，不属于渲染 Mesh。AgentScape 的 Manifest 支持 `convexHull`，Rapier 直接消费凸包顶点；服务器侧可用 CoACD 把复杂 Mesh 分解为多个凸包。

## glTF-Transform 的关键启发

成熟 glTF 基础设施应直接复用。AgentScape 使用它完成二进制读写、结构检查和 `dedup / prune / weld`，避免维护第二套解析器。

## Articulate-Anything 的关键启发

关节推断不能停在“猜一个 joint”。完整链路应该是：

```text
Parts / Links
   ↓
Joint Candidate
   ↓
可执行 articulation
   ↓
运动仿真 / 渲染
   ↓
Critic
   ↓
修正或重试
```

目前 AgentScape 只在浏览器做低置信度候选发现，真正的关节推断留给可替换 Provider。

## Parts / Joint Proposal 研究

1.3 前重新用 CodeGraph 阅读了 EmbodiedGen、SceneSmith、Articulate-Anything、SAPIEN、ManiSkill、GAPartNet 与 yourdfpy。

### 可以直接复用

- **SAPIEN**：Apache-2.0。其 articulated 表示明确保留 parent/child link、joint type、anchor pose、limits 与 drive target；用于验证 AgentScape 的多级 Link 数据模型。
- **ManiSkill**：Apache-2.0。其 ArticulationBuilder 同样按 parent link 拓扑构建 joint，并显式处理 self collision；用于架构参考。
- **yourdfpy**：MIT。直接作为服务依赖，用于 URDF 解析并输出 Part Proposal。

### 只研究，不作为默认依赖

- **GAPartNet**：代码与数据为 CC BY-NC 4.0，不适合作为 AgentScape 默认商业友好依赖。
- **PartNet-Mobility 数据**：数据许可存在额外条款与下游使用限制，不能把它当作 AgentScape 默认可再发布资产源。
- **Articulate-Anything**：研究时未发现清晰许可证，因此只采用 actor → executable articulation → simulator → critic 的思想，不复制源码。

### 最终收敛

AgentScape 不绑定某一个分割模型或数据集，而定义一个 provider-neutral `Part Proposal v1`。可信机械数据、VLM 推断、分割模型和人工标注都可以输出 Proposal；Runtime Manifest 只接收经过结构检查并满足可执行条件的 Part。

## Face-level Part Segmentation 研究

重新用 CodeGraph 阅读 EmbodiedGen 与 Hunyuan3D-Part 后确认：EmbodiedGen 当前 `PartSegmenter` 实际只支持 P3-SAM。P3-SAM 输出的核心是每个三角面的 `face_ids`，并导出带颜色的 segmentation mesh；后续 PartSemanticsAnnotator 再基于 RGB 多视图 + mask 多视图给这些 segment 增加语义/抓取/功能描述。

这与 AgentScape 的 Node-based executable Part 不是同一种数据：

```text
P3-SAM
mesh face → segment id

AgentScape Runtime
GLB node → rigid body → joint → action target
```

因此不能把 P3-SAM segment id 直接塞进 `manifest.parts`。1.4 引入 `Segmentation Evidence v1` 保存 face-level 证据；1.5 在 CodeGraph 重读 glTF-Transform 后增加一个保守的浏览器内 materializer，只处理完整 TRIANGLES 分区，并通过“共享 vertex accessor + 新建 segment indices”的方式生成稳定 GLB Node。复杂的 Skin/Morph/Extension 情况仍必须由外部 Provider materialize。

### Hunyuan3D-Part 许可边界

Hunyuan3D-Part/P3-SAM 使用 Tencent Hunyuan 3D-Part Community License，而不是 MIT/Apache。许可证包含地域、用途、分发等额外条件，因此 AgentScape 不把其源码、权重或模型作为默认依赖。它只作为可选外部 Provider 示例；使用者必须自行确认适用许可证。AgentScape 默认仓库只定义开放 HTTP/JSON 契约。

### EmbodiedGen 的可复用思想

EmbodiedGen 值得保留的不是对某个模型的硬绑定，而是阶段边界：

```text
Part Segmentation
      ↓
Segmentation Quality Check / Repair
      ↓
Part Semantics Annotation
      ↓
Semantics Checker / Bounded Repair
      ↓
Grasp Generation / Evaluation
```

AgentScape 延续这一原则：Segmentation Evidence、Part Proposal、Executable Part、Runtime Verification 分层保存，不把上游推断直接当已验证能力。

### glTF-Transform Materialization 结论

重新检查 glTF-Transform 4.x 后，没有发现一个现成的“按 face label 拆 mesh 成 nodes”的高层 Transform；但 Core API 已经提供足够稳定的 Primitive/Accessor/Node 组合能力。AgentScape 因此没有实现第二套 glTF parser，而只做最小索引重组：

- `Document.createAccessor/createPrimitive/createMesh/createNode`。
- `Primitive.setIndices/setAttribute/setMaterial`。
- 多个新 Primitive 继续引用原 attribute accessor 和 Material。
- `OptimizeGLBPass` 后续继续使用官方 `dedup/prune/weld` 清理已经失去引用的原 Mesh。

这条实现的关键不是“能拆”，而是保持可证明的不变量：整体 Bounds 不变、原 source transform 不变、attributes/material 不变、全部三角面恰好属于一个 segment。任何无法证明这些条件的资产不自动 materialize。

## Part Collider 与几何所有权

1.6 的重点不是再增加一个碰撞算法，而是先定义 articulated 资产的**碰撞所有权**。Whole-asset CoACD 本身不能直接用于 Root + movable Parts，因为同一门板会同时属于 Root hull 和 Door body。

最终模型：

```text
Scene Mesh
   │
   ├─ 最近 executable Part ancestor → 该 Part rigid body
   └─ 没有 executable Part ancestor → Root rigid body
```

浏览器侧复用 glTF-Transform 的 Primitive/Accessor 数据做确定性 local AABB；不重新解析 GLB。真正的 per-part convex decomposition 仍应复用 CoACD，但需要服务端能消费 materialized GLB 或显式 Part mesh artifact 后再接，当前不会把原始 whole-asset URL 的 CoACD 结果冒充 per-part collider。

这一轮还通过真实 Runtime E2E 发现并修正两个坐标/物理语义问题：

1. URDF frame compatibility 使用原始 GLB 检查，但 Rapier anchor 必须来自规范化后的当前 Document。
2. 一个 rigid body 的 `mass` 是总质量；多个 collider 不能每个重复设置完整质量。

两者都属于“代码能跑但物理语义错误”的问题，因此比继续增加模型推断更优先。
