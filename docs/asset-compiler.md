# Agent-Ready Asset Compiler

Asset Compiler 的职责是把普通 GLB 转换成 AgentScape 可以稳定加载、理解、碰撞和操作的资产。它采用可插拔 Pass，而不是一个不可观察的黑盒函数。

## 流水线

```text
GLB bytes / URL
   ↓
GLTFInspectPass
   ↓
GeometryPass
   ↓
SemanticHeuristicPass
   ↓
ArticulationCandidatePass
   ↓
ColliderFallbackPass
   ↓
RemoteEnrichmentPass
   ↓
OptimizeGLBPass
   ↓
ManifestPass
   ↓
CompiledAssetStore (IndexedDB)
```

### 本地 Pass

浏览器始终可执行：

- glTF 结构与统计检查。
- Bounds、尺度、原点与地面的关系。
- 基于名称的低置信度语义分类。
- 基于节点名称的关节候选发现。
- AABB 碰撞代理 fallback。
- glTF-Transform 的 `dedup → prune → weld`。
- Manifest 生成与 Schema 校验。

这些结果会明确记录来源和置信度，不把启发式结果包装成高质量模型推断。

### 重型 Provider

`RemoteEnrichmentPass` 用于替换需要服务器资源的阶段：

- CoACD 凸分解。
- VLM 语义和 affordance。
- 关节轴、范围和运动类型推断。
- 更可靠的质量、摩擦等物理属性估计。

没有 Provider 时系统仍能运行，只是碰撞策略明确降级为 `aabb-fallback`。

## 为什么复用 glTF-Transform

GLB 解析、规范化和优化已经有成熟实现，因此 AgentScape 直接依赖 glTF-Transform，不再实现第二套 glTF 解析器。Compiler 使用动态 import，只有用户真正编译资产时才加载这部分代码。

## 编译产物

优化后的 GLB 二进制写入 IndexedDB，Manifest 使用：

```json
{
  "source": {
    "kind": "compiled",
    "key": "asset_key",
    "fallbackUrl": "https://optional/model.glb"
  }
}
```

同一浏览器刷新后可继续加载本地编译资产。如果 IndexedDB 内容丢失且存在 `fallbackUrl`，AssetManager 会退回远程 GLB。

目前 `scene.json` 会保存 Manifest，但不会把本地 GLB 二进制嵌进 JSON。跨设备完整搬迁应由未来的 Scene Bundle 负责，而不是把大二进制塞进普通 JSON。

## 编译报告

Manifest 的 `compiler` 字段记录：

- 编译器版本。
- GLB 统计信息。
- 优化前后字节数。
- 碰撞生成策略。
- 语义置信度。
- 关节候选。
- 几何警告。

编译报告是资产质量判断的一部分，不应被 UI 或 Agent 隐藏。

## 质量等级

Compiler 不再把“成功生成 Manifest”视为“资产已就绪”。每次编译都会得到明确质量状态：

- `ready`：没有硬错误，也没有已知降级项。
- `provisional`：可运行，但存在明确的不确定性，例如仅有 AABB collider、语义置信度低、发现关节候选但尚未生成可执行关节。
- `rejected`：存在硬错误，例如无效/空几何；不会写入编译资产存储。

Agent 能力必须以**可执行结构**为准。比如柜子文件名或节点名可以提示它可能有门，但在 `parts/joint` 尚未生成并验证前，Manifest 不会暴露 `open/close`。

## 安全边界

可选重型 Compiler 服务会下载外部 GLB，因此服务端明确限制：

- 只允许 `http/https`。
- DNS 解析后的地址必须是公网地址，拒绝私网、回环、链路本地等目标。
- 重定向逐跳重新校验，且限制次数。
- 使用流式下载，在读取过程中执行 `MAX_ASSET_BYTES` 上限，而不是下载完成后才检查。

这些限制用于避免把资产编译服务变成 SSRF 或大文件内存攻击入口。

## 坐标与结构规范化策略

Compiler 对坐标变换采用“能证明安全才修改”的原则。glTF 规范本身使用右手坐标系和 Y-up，因此不会根据模型外形猜测 Z-up 并自动旋转。

| 情况 | 自动处理 | 原因 |
| --- | --- | --- |
| X/Z 中心偏移、底面不在 Y=0 | 是 | 直接复用 glTF-Transform `center({ pivot: 'below' })`，不需要语义猜测 |
| 动画 / Skin | 只做安全 Center | glTF-Transform 会增加 Wrapper 保留动画节点局部变换；不 flatten |
| 多 Scene | 不合并 | Runtime 使用默认 Scene；Compiler 报告 `MULTIPLE_SCENES` |
| 未声明默认 Scene | 不猜场景语义 | 使用第一个 Scene，并报告 `DEFAULT_SCENE_MISSING` |
| 负缩放 | 不 bake | 可能影响 winding、法线、Collider，需要后续验证 |
| 非单位 / 非均匀 Scale | 记录 | 不足以证明模型物理尺度错误 |
| Root 旋转 | 不自动归零 | 可能是作者有意姿态，也可能承载关节/动画语义 |
| Scene Graph flatten | 禁止自动执行 | 会损失部件、关节和动画层级信息 |
| 猜测 X/Y/Z 朝向 | 禁止 | glTF 已定义坐标规范，形状启发式不足以安全改写 |

`StructurePass` 会记录 Scene 数量、默认 Scene、Root 数量、最大层级深度、Skin/Animation、负缩放、非均匀缩放和 Root Transform。`NormalizeTransformPass` 当前唯一主动修改是 `center-below`。

这个策略故意保守：错误地自动旋转或 bake 一个有关节资产，损失通常不可逆；保留结构并产生 advisory 则可以由后续 Provider、验证器或人工处理。

## 可选 Provider 的失败语义

重型 Provider 是增强层，不是浏览器基础编译链的单点故障。

```text
本地确定性 Pass
      ↓
AABB fallback / 本地语义
      ↓
Remote Provider
   ├─ 成功 → 用 CoACD / 重型语义等结果升级
   └─ 失败 → 保留本地结果，并记录 ENRICHMENT_FAILED
```

因此“配置了 Provider”不等于“Provider 离线时整个资产不可编译”。失败会把质量状态降为 `provisional`，但不会覆盖或丢弃已经得到的确定性结果。未来如果某些任务必须依赖重型结果，应由调用方显式要求 strict policy，而不是让普通编译默认变脆弱。

## 服务端 Mesh 质量

浏览器不重复实现 watertight / winding / connected-component 等拓扑算法。可选重型服务已经使用 trimesh，因此直接复用它的检查结果，并通过 `meshQuality` 回传 Compiler：

- `watertight`
- `windingConsistent`
- `components`
- `volume`

这些结果进入 Manifest 编译报告和 CompileQualityPass。非封闭、绕序不一致或多个不连通组件目前作为 advisory；它们不必然使视觉资产无效，但会影响体积估计、碰撞和物理可信度。

## 浏览器资源预算

Compiler 会在优化后的 Document 上重新调用 glTF-Transform `inspect()`，以最终资产而不是原始输入作为准入依据。当前预算是单资产的保守默认值：

| 指标 | 建议上限 | 硬上限 |
| --- | ---: | ---: |
| GLB 输入大小 | — | 100 MiB |
| 默认 Scene 渲染顶点 | 1,000,000 | 3,000,000 |
| 默认 Scene 估算 Draw Call | 200 | 800 |
| 全资产纹理 VRAM 估算 | 256 MiB | 512 MiB |
| 最大纹理边长 | 4096 px | 8192 px |
| 动画关键帧总数 | 100,000 | 500,000 |

超过建议上限会进入 `provisional`；超过硬上限会进入 `rejected`。这些数值是 AgentScape 当前浏览器 Runtime 的准入策略，不宣称是通用 WebGL 极限，后续应根据真实设备基准再调整。

Draw Call 只遍历 Runtime 真正加载的默认 Scene，不把未使用的其他 Scene 误算进去；纹理和动画则按整个 GLB 统计，因为 GLTFLoader 解析资产时这些资源仍会产生加载和内存成本。

### 为什么当前不自动减面或压纹理

预算门只负责判断，不负责偷偷修改资产。自动 simplify、纹理缩放或格式转码可能损失视觉、UV、法线、动画或语义细节，而且往往需要用户选择质量目标。当前做法是先稳定报告真实成本；未来若引入优化策略，应作为显式 Compiler Pass，并保留优化前后报告，而不是在准入检查里隐式执行。

### 输入大小防线

本地文件在 `File.arrayBuffer()` 前先检查 `file.size`；URL 输入先检查 `Content-Length`，未知长度则流式读取并在超过 100 MiB 时立即取消。Compiler 内部仍保留同一上限作为第二道防线。预算常量只维护在 `src/compiler/resourceBudget.js`。

## 可执行 Part 契约

从 1.2 开始，`open / close` 不再由资产类别或节点名直接推导为 Runtime Action。顶层 articulated action 必须能映射到一个真正可执行的 Part。

```json
{
  "parts": {
    "drawer": {
      "node": "Drawer",
      "semantic": "drawer",
      "actions": ["open", "close"],
      "targets": { "open": 0.5, "close": 0.0 },
      "physics": { "body": "dynamic", "colliders": ["..."] },
      "joint": {
        "type": "prismatic",
        "axis": [1, 0, 0],
        "limits": [0, 0.5]
      }
    }
  }
}
```

Schema 会验证：

- Part action 必须唯一。
- `open / close` 必须同时具备 `physics + collider + joint + explicit target`。
- target 必须是有限数，并落在 joint limits 内。
- 顶层 articulated action 必须至少有一个 Part 能真正执行它。

因此“上游模型说它 openable”只是一条 annotation，不会自动变成 Agent 可以调用的 `open`。EmbodiedGen 等 Provider 的原始 affordance 会保留在 provenance 中，只有编译出了可执行 Part/Joint 后才提升为 Runtime Action。

## Articulation Runtime Verifier

`verifyAssetArticulation` 会为资产创建一个隔离的 Rapier World，不污染当前场景：

```text
Asset Manifest
    ↓
AssetManager.instantiate()
    ↓
isolated ObjectStore + PhysicsSystem
    ↓
逐 Part / 逐 target 执行 motor
    ↓
固定步长 Physics step
    ↓
验证局部 position / rotation 真实变化且全部有限
    ↓
写回 manifest.verification.articulation
```

Rapier 0.17.3 没有公开当前 revolute/prismatic coordinate 的 JS API，因此当前 verifier 不伪造“精确 joint angle”读数，而是验证我们实际能观测到的执行链：motor 接受目标、limits 已配置、Part 的 Three.js 局部位姿发生与 joint 类型一致的运动、数值保持有限。

### 为什么 jointed body 默认关闭互相接触

真实测试发现，如果父体和子 Part 的 collider 初始重叠且 joint contacts 开启，prismatic drawer 可以被接触约束顶在打开位置，随后无法关闭。AgentScape 创建 articulation joint 后会显式：

```js
joint.setContactsEnabled(false)
```

父/子刚体仍然受 joint 约束，但不会用彼此的 collider 产生自碰撞阻塞。外部对象与这些 collider 的碰撞仍然正常参与 Rapier。

### Readiness Promotion

存在可执行 Part/Joint、但未验证时：

```text
ARTICULATION_UNVERIFIED
→ provisional
```

Verifier 通过后会移除该 advisory；如果它是最后一个 advisory，资产可以从 `provisional` 晋升为 `ready`。验证失败则写入 `ARTICULATION_VERIFICATION_FAILED`，不会伪装成 ready。

## Part Proposal v1

1.3 开始，Parts/Joint 的来源与 Runtime Manifest 解耦。外部模型、URDF/SAPIEN 数据、人工标注或未来的 Part Segmenter 都先输出统一的 `Part Proposal v1`，Compiler 再判断哪些 Part 可以提升为可执行 Runtime Part。

```json
{
  "version": 1,
  "source": "provider-name",
  "confidence": 0.9,
  "parts": [
    {
      "id": "door",
      "node": "Door",
      "parent": "$root",
      "semantic": "door",
      "joint": {
        "type": "revolute",
        "axis": [0, 1, 0],
        "limits": [-1.2, 0]
      }
    }
  ]
}
```

Proposal 与 executable Part 是两个概念。`PartProposalPass` 会验证：

- Proposal 版本和 `parts[]` 结构。
- `id` 唯一。
- `node` 必须真实存在于当前 GLB。
- `parent` 必须存在或为 `$root`。
- Part 层级不得成环。
- 声明的 Part parent 必须与真实 GLB 节点祖先关系一致；Physics parent 与视觉 hierarchy 不允许分叉。

只有同时具备可支持的 joint、有效 axis/limits、collider、actions 和每个 action 的明确 target，才会提升到 `manifest.parts`。结构有效但条件不完整的 Part 会记录在 `unpromoted[]`，不会成为 Agent Action。

如果可执行 child 的 parent 没有可执行刚体，child 也不会被提升；这样避免产生“Manifest 有 parent 名称，但 Rapier 中没有 parent body”的伪层级。

## URDF → Part Proposal

可选 Compiler 服务新增 `/proposal/urdf`。服务直接复用 MIT 许可的 `yourdfpy`，以 `load_meshes=False`、`build_scene_graph=False` 方式只解析 URDF 机械结构，不重新实现 XML/URDF parser。

它提取：

- parent / child link
- joint type
- normalized axis
- limits
- URDF joint origin matrix
- fixed-link chain 折叠后的最近可动 parent

它**不会**从 link/joint 名称猜 `open / close`，也不会生成 collider、mass 或 action target。因此纯 URDF Proposal 默认是 report-only；后续 Provider 或人工步骤补齐物理与动作契约后，Compiler 才能提升。

Rapier 的 revolute/prismatic axis 与 anchors 都要求在刚体局部空间表达；URDF joint origin 可能带旋转，因此当前 Adapter 保留完整 `originMatrix`，不会未经验证就把 URDF joint frame 猜成 AgentScape 的 `parentAnchor / childAnchor`。

## 多级 Part / Link

`manifest.parts[*].parent` 现在是 Runtime 契约的一部分。PhysicsSystem 会按拓扑顺序创建刚体与 joint：

```text
$root body
   ↓
door body
   ↓
handle/slider body
   ↓
child body ...
```

Three.js 回写也不再假定所有 Part 都直接挂在 Root，而是根据 `node.parent` 的真实世界变换，把 Rapier 世界位姿转换回正确的局部 position/quaternion。

## Segmentation Evidence v1

1.4 开始，face-level Part 分割与 Runtime Part 明确分层。P3-SAM、Hunyuan3D-Part 或其他分割 Provider 可以返回紧凑的 `partSegmentation` 证据：

```json
{
  "version": 1,
  "source": "p3sam/external",
  "faceCount": 12000,
  "segments": [
    { "id": "0", "faceCount": 3400, "confidence": 0.91, "semantic": "door" }
  ],
  "artifact": {
    "kind": "face-labels",
    "url": "https://provider.example/result/labels.npy"
  }
}
```

浏览器只保留摘要、coverage、可选 bounds/semantic 与 artifact 引用，不把完整 `face_ids` 数组写进 Manifest/Trace。`face segment` 不等于 GLB Node，因此不会直接进入 `manifest.parts`。如果只有分割证据、还没有与当前 GLB Node 对齐的 Part Proposal，质量门会给出 `PART_SEGMENTATION_UNMATERIALIZED`，资产保持 `provisional`。

这使外部重型分割模型可以自由替换，同时避免把“某些三角形属于同一视觉区域”误解成“Runtime 已经有独立 rigid body / joint / action”。

## URDF Joint Frame → Rapier Anchor

`JointFramePass` 会在 `PartProposalPass` 前尝试把可信 URDF joint frame 编译为显式 Rapier anchors，但只处理可证明安全的子集。

URDF 约定：joint origin 是 Parent Link → Joint Frame；Child Link Frame 在零位姿与 Joint Frame 重合；axis 在 Joint Frame 中表达。Rapier 则要求 `anchor1/anchor2` 分别位于两个 rigid-body local frame。

因此 Compiler 会使用 **规范化前** `GLTFInspectPass` 保存的 `worldMatrix`，比较 GLB 零位姿与 URDF `parentToJointMatrix`：

```text
原始 GLB child zero pose
        │
        ├── 与 URDF parent→joint translation 一致？
        ├── rotation 一致？
        ├── scale 为 1？
        └── joint-frame rotation 不改变 axis 数值方向？
                    │
              全部满足
                    ▼
parentAnchor = URDF joint position in parent local
childAnchor  = [0, 0, 0]
                    │
                    ▼
            进入 PartProposalPass
```

如果任一条件不满足，会记录 `JOINT_FRAME_*` issue，并保持缺少 anchor 的 report-only 状态；不会为了提高晋升率而猜坐标。多级 Part 会先把 parent Part 的原始 world transform 求逆，再比较 child relative transform。

URDF Adapter 现在还会把 fixed-link chain 的变换累积为 `parentToJointMatrix`。因此：

```text
movable parent
  └─ fixed offset
       └─ fixed mount
            └─ movable child
```

可以正确折叠为一个 parent→child joint frame，而不是只保存最后一个 `<joint origin>`。

## Node 名称唯一性

Part Proposal 通过 GLB node name 绑定几何，因此同名节点不再被静默解析。目标名称不存在会得到 `PART_NODE_MISSING`；出现多个同名节点会得到 `PART_NODE_AMBIGUOUS`。Provider 必须先让资产节点身份明确，再进入可执行晋升。
