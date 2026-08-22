# AgentScape 重型资产编译服务

这是可选的服务器侧 Compiler，用于不适合在浏览器主线程执行的几何任务。当前实现的重型 Pass 是 CoACD 凸分解。

## 启动

```bash
python -m venv .venv
. .venv/bin/activate
pip install -r requirements.txt
uvicorn app:app --host 0.0.0.0 --port 8080
```

然后把 AgentScape 页面中的 **Compiler Endpoint** 配置为：

```text
https://your-host/compile
```

## 工作流程

```text
公开可访问的 GLB URL
      ↓
trimesh 加载并展开 scene transform
      ↓
合并几何
      ↓
CoACD
      ↓
多个 convexHull collider
      ↓
质量/摩擦估计
      ↓
返回浏览器 Compiler
```

如果服务未配置，浏览器使用明确标记的 AABB fallback，功能不会被阻塞。

## 安全限制

服务会访问用户提供的 GLB URL，因此默认拒绝私网、回环、链路本地和其他非公网地址；每次重定向都会重新校验。下载采用流式读取，并受 `MAX_ASSET_BYTES` 限制。生产部署仍建议放在独立容器/网络策略后面，并限制允许访问的域名范围。

## URDF Part Proposal

服务提供：

```http
POST /proposal/urdf
Content-Type: application/json

{ "url": "https://example.com/model.urdf" }
```

返回 `partProposal`。URDF 由 `yourdfpy` 解析，最大默认大小由 `MAX_URDF_BYTES` 控制（默认 5 MiB）；URL 使用与 GLB 下载相同的公网地址、重定向和 SSRF 检查。

该端点只输出机械结构，不生成 action/collider。它适合把 SAPIEN/URDF 生态已有的可信 link/joint 信息送入浏览器 Compiler，再由后续阶段补齐可执行条件。
