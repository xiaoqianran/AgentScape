# AgentScape

> v2 开发实现已包含统一 Scene API、Recipe、完整项目包与三种 StylePack；SDK 尚未发布。最新能力与限制见 [v1 契约](planning/public-contracts-v1.md)和[发布清单](docs/v2-release.md)。

**让人和 AI 能够操作同一个交互式 3D 世界。**

Three.js 渲染、Rapier 物理和 Recast 导航共享真实世界状态。人物能够走近物体、拾取和放置；请求成功与实际行为验证分开报告。

[在线 Studio](https://agentscape-virid.vercel.app/) · [在线入门世界](https://agentscape-virid.vercel.app/starter/) · [English](README.md) · [入门示例](apps/starter/README.md) · [MCP](apps/mcp-server/README.md) · [贡献指南](CONTRIBUTING.md)

## 运行第一个世界

需要 Node.js 22.12+、npm 和支持 WebGL2 的浏览器。

```sh
git clone https://github.com/xiaoqianran/AgentScape.git
cd AgentScape
npm ci
npm run starter
```

打开终端显示的 `/starter/` 页面，通常为 `http://127.0.0.1:5173/starter/`。

1. 点击拾取杯子，再放到桌上，等待实际验证结果。
2. 添加椅子并移动。
3. 下载世界 JSON，刷新页面，再打开下载的文件。

这个示例使用内置物体，无需模型密钥、生成服务或 Docker。安装依赖仍需要网络。Vercel 已提供公开静态预览：[Studio](https://agentscape-virid.vercel.app/)、[入门世界](https://agentscape-virid.vercel.app/starter/)、[首页](https://agentscape-virid.vercel.app/home/)和[诊断台](https://agentscape-virid.vercel.app/observatory/)。该预览不提供私有 MCP 服务，也不包含依赖本地服务的可选生成能力。

修改 `apps/starter/scene.json` 后刷新即可改变初始布局。支持 agent、cup、table、chair 四种内置物理资产；`main.js` 展示统一 SDK 的使用方式，包括浏览器帧循环。

## 当前边界

Starter 是最小学习入口；Studio 编辑器仍在 `/`，诊断台在 `/observatory/`。现有 MCP 的独立世界、程序化资产、真实交互与可信恢复继续保留。远程源码构建需要受限 Docker 环境。

SDK 已支持自包含 GLB Visual、受约束 Recipe、完整项目包和三种 StylePack；Starter 的按钮仍保持最小学习范围，Studio 提供风格切换。项目仅支持 monument-hall、32 个实体；YAML、任意 Shader 插件和通用压缩包上传不属于 v1。SDK 是未发布的开发版。

## 验证与贡献

```sh
npm run test:starter
npx playwright install chromium
npm run test:browser:starter
npm run check
```

欢迎提交示例、文档、翻译、可复现问题和代码改进。参与步骤见 [CONTRIBUTING.md](CONTRIBUTING.md)。底层六系统继续保留，不为入口简化复制世界状态。

代码采用 [MIT](LICENSE)；第三方模型、贴图和依赖的条款见 [THIRD_PARTY.md](THIRD_PARTY.md)，不能把代码许可证当成所有内容的许可证。
