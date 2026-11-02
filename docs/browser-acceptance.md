# Studio 浏览器核心流程验收

此入口验证生产构建中的用户流程：干净浏览器首次进入世界、非空 WebGL 画布、对象选择与缩放、撤销重做、非法输入、资源放置、场景保存重开、草稿保存重开、错误导入保护、跨页面画布身份，以及任务开始／取消／重新观察后重试。

```sh
npm ci
npx playwright install chromium
npm run test:browser
```

Linux 首次安装浏览器及系统依赖用 `npx playwright install --with-deps chromium`。测试自行生产构建并在 `127.0.0.1:4178` 启动预览；端口冲突直接失败，不复用未知服务。每个用例使用全新浏览器上下文，不复制个人存储或配置。

模型服务由 `tests/browser/fixtures.js` 内固定协议数据代替；仅模拟 `/api/capabilities` 和 `/api/capabilities/agent`，世界运行时、物理、编辑、持久化及页面仍为真实产品代码。固定响应不是模型评测，也不请求生成服务。不得把这套测试的结果写成真实 LLM 成功率或真实生成成功证据。

渲染检查要求 Runtime ready、可用且未丢失的 WebGL 上下文、有尺寸的画布，以及截图像素的非零颜色分布。环境不支持渲染或画布空白时断言失败，没有跳过分支。软件渲染有助于 CI 复现，不代表用户硬件上的帧率成绩。

报告位于 `playwright-report/`；失败截图、视频、Playwright trace 位于 `test-results/browser/`。每例报告附带控制台、未捕获异常、网络状态、验证范围。网络摘要不记录请求正文、授权头和密钥。CI 无论成功失败均上传报告，失败不会自动重试到通过。

```sh
npx playwright show-report
npx playwright show-trace test-results/browser/<case>/trace.zip
```

日常 `npm run check` 继续承担原有模块回归；浏览器验收是独立 CI job。真实模型、真实生成与真人首次使用仍需另外授权和取证。
