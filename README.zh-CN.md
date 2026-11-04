# AgentScape

**让人和 AI 能够操作同一个交互式 3D 世界。**

Three.js 渲染、Rapier 物理和 Recast 导航共享真实世界状态。人物能够走近物体、拾取和放置；请求成功与实际行为验证分开报告。

[English](README.md) · [入门示例](apps/starter/README.md) · [MCP](apps/mcp-server/README.md) · [贡献指南](CONTRIBUTING.md)

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

这个示例使用内置物体，无需模型密钥、生成服务或 Docker。安装依赖仍需要网络。本轮尚未发布公网 Playground。

修改 `apps/starter/scene.json` 后刷新即可改变初始布局。支持 agent、cup、table、chair 四种内置物理资产；`main.js` 展示实验性 Scene API 的完整使用方式，包括浏览器帧循环。

## 当前边界

Starter 是最小学习入口；Studio 编辑器仍在 `/`，诊断台在 `/observatory/`。现有 MCP 的独立世界、程序化资产、真实交互与可信恢复继续保留。远程源码构建需要受限 Docker 环境。

Starter 尚不支持任意 GLB 上传、纯视觉资产、StylePack、YAML、源码构建或分享链接。新的三个公共契约仍是[设计草案](planning/public-contracts-v1.md)，此处实验性 API 不等于完整 v1，也不是已发布的 npm SDK。

## 验证与贡献

```sh
npm run test:starter
npx playwright install chromium
npm run test:browser:starter
npm run check
```

欢迎提交示例、文档、翻译、可复现问题和代码改进。参与步骤见 [CONTRIBUTING.md](CONTRIBUTING.md)。底层六系统继续保留，不为入口简化复制世界状态。

代码采用 [MIT](LICENSE)；第三方模型、贴图和依赖的条款见 [THIRD_PARTY.md](THIRD_PARTY.md)，不能把代码许可证当成所有内容的许可证。
