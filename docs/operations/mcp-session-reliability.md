# 本地 Studio MCP 会话可靠性与权限边界

## 自动连接的身份隔离

本地 Studio 在受允许的本机 Origin 上自动注册标签页，并通过独立的 Studio token 进行浏览器轮询。MCP 操作仍需要有效的 MCP Bearer 身份；不会把 Bearer token 交给浏览器。

自动会话在**首次被经认证的 MCP 身份访问时**绑定该身份。同一标签页重注册新世界或短暂断开后重连时，在本进程有界的 10 分钟绑定窗口内保留该身份（最多追踪 64 个标签页）；其他 MCP 身份不能使用该会话 ID 观察或修改其世界。多个尚未绑定的标签页仍须显式选择 session ID，系统不会随机选择目标。

注意：首次访问绑定是本机单用户工作流的安全加固，**不等于浏览器用户身份验证**。如果多个不互信的 MCP 用户共用一台服务，首次拥有合法 token 的调用者可能绑定尚未绑定的自动会话。因此多租户服务必须禁用自动连接或另外配置经过认证的显式配对/所有权授权层，不应把此协议直接暴露到公网。默认的 HTTP Bridge 仅允许 loopback Host 与列出的本机 Origin。

断开连接、环境切换、超时或关闭会撤销当前 worldSessionId；旧会话不可再执行命令。服务器重启后自动重连会建立新的会话，原有身份绑定不跨进程持久化；不要在缺少服务器侧身份授权的部署中将重连视为跨租户隔离边界。

## 幂等窗口

`scene_apply` 与 Studio RPC 使用同一个有界的内存幂等策略：

- 同一会话、相同 requestId 和参数：在记录存留期内重用原始 Promise / 结果；不会再次执行已记录的操作。
- 同一 requestId 但参数不同：拒绝并返回 `REQUEST_CONFLICT`（SceneFacade）或 `IDEMPOTENCY_CONFLICT`（Studio Bridge）。
- 每个会话最多保留 256 条记录；已完成记录保留至多 5 分钟，在达到上限时可提前淘汰**最早已完成**的记录，以便长时间持续编辑。
- 仍在执行的请求不可被缓存淘汰。若全部容量均被进行中的请求占用，返回明确的容量错误，而不是重复执行。
- 此缓存并非永久去重：过期或被容量淘汰的 requestId 可能被当成新请求。调用端必须为每次新编辑生成唯一 ID；涉及长期恰好一次交付时需要额外的持久化去重与事务机制。

客户端仍需要检查操作状态、物理验证证据和失败原因；请求已被转发不等于物理动作完成。

## 验收

```sh
npx vitest run tests/mcp/studio-request-window.test.js tests/mcp/studio-auto-connect.test.js tests/integration/scene-request-window.test.js
npm run test:mcp
npm run check
npx playwright test tests/browser/studio-auto-connect.spec.js tests/browser/native-scene.spec.js
```
