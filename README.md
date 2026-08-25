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
- GLB 保留对输入图片的 `derived_from` lineage。

## 命令

```bash
agentscape probe
agentscape image "a mossy stone shrine" -o reference.webp
agentscape reconstruct reference.webp --concept "stone shrine" --model fastsam3d --output model.glb
agentscape create "a mossy stone shrine" --model fastsam3d -o artifacts/shrine
```

实际模型 ID 以 `modal-3D-client` 的 `/v1/models` 动态 capability 为准，不在 AgentScape 中硬编码。
