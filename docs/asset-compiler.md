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
