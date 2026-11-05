# Studio Live Bridge：MCP 控制浏览器当前世界

**更新：本机 Studio 已默认自动连接，无须手动配对。** 优先阅读 [Studio MCP 自动连接](./mcp-studio-auto-connect.md)。本文保留手动配对流程，供兼容旧客户端或指定独立会话时参考。

这是一个 **PC2 本地、明确配对、单一 WorldRuntime** 的实验性控制通道。MCP 客户端使用已有的 Scene API，浏览器继续使用原来的 SceneFacade、WorldRuntime、Rapier 和导航系统；服务端不复制第二个运行时，不接受任意脚本或浏览器 DOM 命令。

## 启动与配对

1. 在 PC2 上按照 [MCP 服务说明](../apps/mcp-server/README.md)配置独立的 AGENTSCAPE_MCP_TOKENS，并运行 npm run mcp:serve。默认仅监听 127.0.0.1:39015。
2. 使用已认证的 MCP 客户端调用 studio_pair_create；返回 worldSessionId 和仅两分钟有效的一次性 pairCode。
3. 在本机打开 Studio，进入世界页面，点击「MCP 连接」，粘贴 pairCode 并明确授权。
4. 客户端使用返回的 worldSessionId 调用 session_attach 检查连接，然后调用现有的 scene_observe、scene_apply、scene_add_model、scene_interact、scene_job、scene_cancel、scene_verify、scene_save 或 scene_set_style。
5. 可以调用 studio_session_status 检查连接。切换世界、刷新 Studio、主动断开或关闭 MCP 服务时，旧会话失效；再次操作必须重新配对。

浏览器仅持有短期单独的 studioToken，MCP Bearer Token 不发送给浏览器。pairCode 一次使用后即失效，代码与 token 均不写入 LocalStorage。HTTP Bridge 只接受本机 Host 和明确列入白名单的 Studio Origin。默认支持本地 Vite 5173 与预览 4178，自动化验收也允许 4189。暂不对公网 Studio 域名启用配对端点。

## 示例

客户端调用：

~~~json
{"tool":"studio_pair_create","arguments":{}}
~~~

浏览器配对后：

~~~json
{"tool":"session_attach","arguments":{"worldSessionId":"<返回的 worldSessionId>"}}
~~~

然后添加已有物体：

~~~json
{"tool":"scene_add_model","arguments":{"worldSessionId":"<同一 worldSessionId>","requestId":"<新的 UUID>","model":{"id":"demo_chair","asset":"builtin://chair","position":[0,0,-2]}}}
~~~

返回成功后，Studio 场景列表和 3D 画面会显示同一个实体。后续可以 scene_observe、scene_interact 再轮询 scene_job；Scene 接口的成功与真实物理验证仍是两个独立结果。

## 协议与限制

- Studio 拥有唯一世界事实源，MCP Server 仅负责身份、明确配对、命令路由与过期控制。
- 同一 Live 会话一次只接收一个未完成的 RPC，后续请求得到 STUDIO_BUSY。任务执行中的异步 Scene Job 不占据整个 RPC 队列；请用 scene_job 查询。
- 宿主与浏览器之间采用短轮询；失去连接、世界切换或超时会拒绝后续操作。无页面时仍可使用原有独立 Headless 会话。
- 不支持一次连接多个浏览器，不提供远程截图、音视频、实时多人同步或任意文件上传。
- 此版本只支持 localhost 的明确白名单 Origin；生产部署应为 Studio 与 MCP 提供独立的授权、TLS 和跨网络安全模型，不能直接将本地 HTTP Bridge 公开到互联网。
- 包含 GLB bytesBase64 的小请求仍受 MCP 64 KiB HTTP 正文上限限制。大型模型应走已有资产构建与 AssetRef，并在后续版本提供更好的上传能力。
- Studio 页面必须保持运行，页面刷新、环境切换后需重新配对，远程 MCP 不应继续控制旧页面。

## 验证

~~~sh
npx vitest run tests/mcp/studio-live-bridge.test.js tests/integration/mechanical-asset-reliability.test.js
npx playwright test tests/browser/studio-live-bridge.spec.js
npm run typecheck
npm run architecture:validate
~~~
