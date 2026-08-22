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

### 独立服务 CI

`Asset Compiler Service Check` 只在 `services/asset-compiler/**` 或自身 workflow 变化时运行，安装完整 `requirements.txt` 并测试 URDF 转换与 Part geometry。GitHub Pages 的 Node 构建仍保持纯前端，两条 CI 互不阻塞。

## Per-Part CoACD

同一个 `/compile` endpoint 还接受 multipart：

```text
stage = part-geometry
metadata = {"parts":[{"id":"door","node":"Door__part_door","parent":"$root"}]}
asset = 当前 materialized GLB binary
```

服务按 Part Node 层级提取 Part-local Mesh，再逐 Part 运行 CoACD。`MAX_PARTS_PER_REQUEST` 默认 32，metadata 默认限制 256 KiB，上传 GLB 继续受 `MAX_ASSET_BYTES` 限制。单个 Part 的提取或 CoACD 失败不会终止同批其它 Part。

质量/质量估算规则：只有 watertight volume 才返回 Part mass；非 watertight mesh 仅返回 geometry report 与 collider。
