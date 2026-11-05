# Studio MCP 自动连接（本机默认开启）

AgentScape 的 **本机 Studio** 现在默认主动连接本地 MCP 服务。MCP 客户端不需要获取或输入配对码，也不需要在 Scene 工具中提交 worldSessionId。MCP 仍需正确配置 Bearer Token 认证。

## 使用

1. 在 PC2 配置 AGENTSCAPE_MCP_TOKENS，启动 npm run mcp:serve。服务绑定在 127.0.0.1:39015。
2. 在同一台 PC2 打开 http://127.0.0.1:5173 并进入 Studio 的世界页面。Studio 默认启用「允许本机 MCP 自动控制当前世界」，并自动注册当前 WorldRuntime。
3. AI 使用已经连接并通过 Bearer Token 认证的 MCP 客户端，直接调用 scene_observe、scene_add_model、scene_apply、scene_interact、scene_job、scene_verify 等工具。**省略 worldSessionId 时默认选择唯一的本机 Studio 世界**。
4. 切换 Studio 世界后，旧世界会话立即失效，并在新世界完成切换后自动注册；刷新页面后也会重新注册。
5. 在 Studio 工具栏的 MCP 面板取消勾选即可禁用。这个选择保存在本机浏览器 LocalStorage；新浏览器首次打开时默认开启。重新勾选可恢复自动模式。

例如：

~~~json
{"tool":"scene_observe","arguments":{}}
~~~

~~~json
{"tool":"scene_add_model","arguments":{"requestId":"<UUID>","model":{"id":"my_chair","asset":"builtin://chair","position":[0,0,-2]}}}
~~~

MCP 客户端仍然可以使用 session_attach（不传 worldSessionId）确认当前世界和其会话 ID；显式提交 worldSessionId 时可继续控制原有 Headless 世界或指定 Studio 会话。旧的 studio_pair_create / 手动配对保留在界面「高级」中，以兼容旧客户端。

## 隐私与安全边界

- **自动连接仅用于 localhost Studio**：浏览器页面需要通过 localhost 或 127.0.0.1 打开，MCP 服务只能监听本机环回接口，Bridge 服务端必须检查 Host 和允许的 Studio Origin。
- **自动控制默认开启**意味着所有有权使用本机 MCP Bearer Token 的 AI 客户端都可以控制当前唯一的 Studio 世界。请只给可信客户端 Token，并使用 Studio 开关随时禁止控制。
- 浏览器**不会获得 MCP Bearer Token**。桥接会话只在内存中保存随机会话凭据；无需人工复制配对码。非可信网页 Origin 不允许调用自动注册接口。
- 同时打开多个 Studio 标签页时，无 ID 的 Scene 操作会返回 STUDIO_MULTIPLE_WORLDS，不会猜测目标。此时可关闭其他标签页、在其他标签页关闭 MCP 控制，或者显式指定 WorldSessionId。
- 当本机 MCP 服务尚未启动，Studio 不会阻止页面使用；会自动退避重试，服务启动后恢复连接。
- 关闭 MCP 自动控制会撤销当前 Live 会话；原有独立 Headless 世界不受影响。
- 公网 Studio 不自动连接本机 MCP，也不自动授权。跨机器或公网使用需单独设计 TLS、身份和权限协议。
- 这是本机实验功能，不提供远程视频、多用户账号和任意 JS 执行能力。底层仍使用原有 SceneFacade、物理验证、场景事务和资源准入。

## 验证

~~~sh
npx vitest run tests/mcp/studio-auto-connect.test.js tests/mcp/studio-live-bridge.test.js
npx playwright test tests/browser/studio-auto-connect.spec.js tests/browser/studio-live-bridge.spec.js
npm run typecheck
npm run architecture:validate
~~~
