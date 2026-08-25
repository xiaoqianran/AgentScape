# AgentScape-client

把 `kaggle-inference-hub` 的文生图能力与 `modal-3D-client` 的本地 Agent / Modal 3D 工作流组合成统一的 3D 资产流水线。

当前 MVP：

```text
prompt
  -> kaggle-inference-hub /task
  -> generated image
  -> modal-3D-client /v1/projects
  -> SAM Top-1 + canonical RGBA
  -> modal generation job
  -> GLB
  -> manifest.json
```

## 安装

```bash
python -m venv .venv
. .venv/bin/activate
pip install -e '.[dev]'
```

## 配置

```bash
export AGENTSCAPE_KAGGLE_URL=http://127.0.0.1:30100
export AGENTSCAPE_KAGGLE_TOKEN='...'
export AGENTSCAPE_MODAL_AGENT_URL=http://127.0.0.1:39000
# 仅当 modal-3D Agent 启用了本地会话校验时需要：
export AGENTSCAPE_MODAL_AGENT_SESSION='...'
```

`modal-3D-client` 的 sidecar 默认绑定随机本地端口，因此 `AGENTSCAPE_MODAL_AGENT_URL` 应指向当前正在运行的 Agent 地址。Agent 需要已经连接 Modal，或由桌面客户端恢复凭据。

## 契约边界

`manifest.json` 是本地流水线结果，不伪造 Connector session、Job identity 或 artifact location。
其中 `result.artifacts` 直接兼容 AgentScape 的 `GenerationJobProjection.result`，统一 Connector 后只需补 Job identity 与传输 location。

- 最终 GLB role 为 `primary-glb`；
- 当前 Kaggle WebP 属于有损历史链，标记为 `legacy-lossy`，不能冒充未来 2D→3D 的 lossless `primary-image`；
- Artifact ID 是独立 opaque identity，SHA-256 只负责内容校验与去重；
- GLB 保留对输入图片的 `derived_from` lineage；
- 3D operation 固定为 `modal-3d.asset.image_to_3d.v1`；
- `requestHash` / `idempotencyKey` 与 AgentScape 的稳定 JSON 算法一致，且敏感字段直接拒绝进入 Job request；
- direct `modal-3D-client` adapter 支持取消与持久 Job 恢复；统一 Connector 下的 `cancel/resume/idempotency` 能力以实时 capability snapshot 为准，不在 client 硬编码；
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
- `modal-2d` 当前尚无实际仓库与最终 input wire schema，因此 Connector pipeline 通过 request builder 注入 provider-specific inputs，避免 client 提前发明字段。

## 命令

```bash
agentscape probe
agentscape image "a mossy stone shrine" -o reference.webp
agentscape reconstruct reference.webp --concept "stone shrine" --model fastsam3d --output model.glb
agentscape create "a mossy stone shrine" --model fastsam3d -o artifacts/shrine
```

实际模型 ID 以 `modal-3D-client` 的 `/v1/models` 动态 capability 为准，不在 AgentScape 中硬编码。
