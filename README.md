# AgentScape-client

通过 Unified Connector 组合 `modal-2D-client` 的 lossless Text→Image 与 `modal-3D-client` 的 Image→3D，产出可验证、可追踪的 3D 资产流水线。

当前默认执行路径：

```text
prompt
  -> AgentScape-client
  -> Unified Connector /connector/v1/*
  -> modal-2d provider
  -> lossless primary-image PNG
  -> modal-3d provider
  -> primary-glb
  -> manifest.json
```

`AgentScape-client` 默认不再直连 2D/3D provider-local API。Connector 统一持有 pairing、capability provenance、global Job identity、idempotency、eventSequence 与 Artifact lineage。Direct adapter 仅保留兼容/诊断用途；任意本地图片尚未纳入 Connector Artifact lineage，因此只通过显式 `reconstruct-direct` 命令使用旧直连路径。

## 安装

```bash
python -m venv .venv
. .venv/bin/activate
pip install -e '.[dev]'
```

## 配置

```bash
export AGENTSCAPE_CONNECTOR_URL=http://127.0.0.1:39000
export AGENTSCAPE_CONNECTOR_ORIGIN=http://localhost:3000
export AGENTSCAPE_CONNECTOR_PAIRING_TOKEN=...
# 若使用 modal-3D 桌面 sidecar，也可复用：
# export AGENTSCAPE_MODAL_AGENT_SESSION=...
```

`AGENTSCAPE_CONNECTOR_URL` 应指向 `modal-3D-client` 暴露 Unified Connector 的当前本地 Agent 地址；桌面 sidecar 使用随机端口时，应传入实际地址。桌面 sidecar 会复用自身 256-bit session token 作为 pairing approval，因此 `AGENTSCAPE_CONNECTOR_PAIRING_TOKEN` 未设置时会回退到 `AGENTSCAPE_MODAL_AGENT_SESSION`。CLI 为一次性进程，每次运行通过 pairing approval 建立独立的短期 Connector session，approval/token 不写入 manifest、缓存或日志。

仅 `reconstruct-direct` 仍使用：

```bash
export AGENTSCAPE_MODAL_AGENT_URL=http://127.0.0.1:39000
export AGENTSCAPE_MODAL_AGENT_SESSION=...
```

## 契约边界

`manifest.json` 是本地消费结果：Job identity、Artifact identity 与 lineage 均来自 Connector；session credential 不进入 manifest。`result.artifacts` 直接兼容 AgentScape 的 `GenerationJobProjection.result`。

- 最终 GLB role 为 `primary-glb`；
- `modal-2D-client` direct adapter 的 PNG 标记为 lossless `primary-image`；保留的 Kaggle WebP adapter 仍严格标记为 `legacy-lossy`；
- Artifact ID 是独立 opaque identity，SHA-256 只负责内容校验与去重；
- GLB 保留对输入图片的 `derived_from` lineage；
- 3D operation 固定为 `modal-3d.asset.image_to_3d.v1`；
- `requestHash` / `idempotencyKey` 与 AgentScape 的稳定 JSON 算法一致，且敏感字段直接拒绝进入 Job request；
- direct `modal-3D-client` adapter 支持取消与持久 Job 恢复；统一 Connector 下的 `cancel/resume/idempotency` 能力以实时 capability snapshot 为准，不在 client 硬编码；
- direct `modal-3D-client` adapter 优先支持新 `project → preprocess(rembg) → canonical RGBA → generation` 链，只有 `/preprocess` 明确 404/405 才回退旧 SAM `segment → materialize`；
- 新 preprocess canonical 必须满足 `1024×1024 / RGBA / image/png / canonical-rgba`，422/5xx 等真实预处理失败不会偷偷降级；
- 生成 GLB 通过 Job-scoped artifact endpoint 获取，不再使用已退休的 path-based `/v1/assets`；
- `JobController` 统一 `submit/get/cancel/observe` 的幂等与状态迁移门禁，状态机与 AgentScape 完全一致；
- `JobController` 只保留进程内 projection cache，不写 DB、不管理 Connector session，也不冒充统一 Connector 的持久 JobStore；
- `ConnectorSession` 校验配对 scope、过期时间、Connector identity 与 capability provenance，且只允许 bare loopback Connector origin；
- `ConnectorCapabilityClient` 从 `/connector/v1/capabilities` 自动发现真实 operationVersion / contractVersion / outputRoles / revision / hash，再构造 `ConnectorHttpJobTransport`；
- `ConnectorHttpJobTransport` 对齐 `/connector/v1/jobs` 的 submit/get/cancel wire contract，不再要求调用方手填 capability provenance；
- Connector session token 只进入 Authorization header，不进入 Job request、manifest、缓存或错误文本；projection 若回显当前 credential 会直接拒绝；
- Connector Job parser 校验完整 projection facts，并用归一化事实签名处理同一 `eventSequence` 的冲突检测；
- `ConnectorArtifactTransport` 从 `/connector/v1/artifacts/{id}` 流式下载产物，校验 scope / redirect / MIME / encoding / bytes / SHA-256 / 内容结构后才原子发布；
- 当前 Artifact 内容门支持 GLB、PNG、JPEG、WebP，足够覆盖统一 2D→3D 主链；未知 MIME fail closed；
- `ConnectorTextTo3DPipeline` 已完成两阶段 Job 编排：2D `primary-image` 直接以 opaque artifact reference 交给 3D request builder，最终只下载 `primary-glb`；
- 组合式 pipeline 默认只接受 `image/png` 作为 lossless `primary-image`，preview/WebP 不会自动进入 3D；
- `Modal2DTextToImageRequestBuilder` 已对齐真实 `modal-2D` public contract：`prompt/model/seed/guidance`，固定 `recommended` profile 与 `primary-image`，不暴露 SANA-Sprint 无效的 `steps` 覆盖；
- `Modal3DImageTo3DRequestBuilder` 已对齐真实 Connector 3D contract：`sourceArtifact{id,role,mime,hash}` + `model/seed`，固定 `primary-image` PNG 输入、`recommended` profile 与 `primary-glb` 输出；模型 ID 由实时 capability/config 选择，不在 client 硬编码；
- 契约级 E2E 已覆盖 `Session → Capability → 2D Job → primary-image ref → 3D Job → primary-glb → Artifact → manifest`，并验证 capability revision/hash 漂移会在下一阶段 submit 前 fail closed。

## 命令

```bash
agentscape probe
agentscape image "a mossy stone shrine" -o reference.png
agentscape reconstruct-direct reference.png --concept "stone shrine" --model fastsam3d --output model.glb
agentscape create "a mossy stone shrine" --model fastsam3d -o artifacts/shrine
```

默认命令的模型/capability 以 Unified Connector `/connector/v1/capabilities` 为准，不在 AgentScape 中伪造 provider 可用性。`reconstruct-direct` 是唯一显式 legacy 直连入口。
