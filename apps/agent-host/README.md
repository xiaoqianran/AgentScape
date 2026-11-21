# AgentScape 双 Agent Host（Pi / DeepSeek Harness）

Studio 的 **WorldRuntime 始终在浏览器中**。这个 Node Agent Host 只负责模型 Agent 的运行；
Pi / DSH 通过同一个 **受限的 AgentScape MCP** 接口操作当前 Studio 世界。

## 安装和启动

在 PC2 AgentScape 根目录：

```powershell
npm ci
# 终端 1：启动受限 MCP + Pi/DSH Agent Host（自动生成私有 MCP Token）
npm run agent:stack
# 终端 2：Studio 界面
npm run dev
# 可选终端 3：仅 Legacy 自研 Agent 的模型网关
npm run agent:gateway
```

推荐使用 `agent:stack`：MCP Token 在 Node 本地进程内随机生成，不需要手动配置。若已有 MCP Server 正在运行，才使用单独 `npm run agent:host`，并在 MCP Server 与 Agent Host 的私有环境中配备匹配的 Token。

本地运行应在 Agent Host 的私有进程环境提供：

- `AGENTSCAPE_MCP_TOKEN`：仅分离启动时必填，且必须与 MCP Server 对应；`agent:stack` 会自动生成。**勿将 Token 写入前端、Git、localStorage 或页面源码**。
- `AGENTSCAPE_MCP_URL`：缺省 `http://127.0.0.1:39015/agent-mcp`。Host 只连接回环 HTTP 的 `/agent-mcp`。
- `AGENTSCAPE_LLM_BASE_URL` / `AGENTSCAPE_LLM_API_KEY` / `AGENTSCAPE_LLM_MODEL`：Pi 使用 OpenAI-compatible NewAPI。也会读取既有 `AGENTSCAPE_TEST_LLM_*` 私有值作为本地开发兜底。

DSH 还需要显式设置 `AGENTSCAPE_DSH_RESTRICTED=1`。默认通过 `dsh-newapi.patch.yml` 使用与 Pi 相同的 NewAPI 配置；
也可设置 `AGENTSCAPE_DSH_PROVIDER` 与 `AGENTSCAPE_DSH_MODEL` 选择经过审核的其他模型路由。
DSH 需要单独的进程运行时，使用同版本的 `@deepseek-ai/dsh-sdk-client` 和 `@deepseek-ai/dsh`。
默认补丁 `dsh-restricted.patch.yml` 关闭 Shell、文件系统工具和工作目录工具，仅保留 AgentScape MCP 工具。
**任何修改此补丁、默认 Profile 或 DSH 供应商的行为，都必须重新检查 `dsh --dump-config` 并做权限审查。**

DSH 启动方式目前属于受限技术预览；若 MCP 不可达、补丁不可用或凭据不完整，Host 应明确失败，不会自动退回无隔离的 Shell。

## Studio UI

Studio 任务页可选择 Legacy、Pi 和 DSH。Host 位于 `127.0.0.1:8789`。
`GET /health` 只输出后端配置状态，不包含密钥；`POST /run` 可选择 NDJSON 事件流；`POST /cancel` 请求取消。
浏览器只连接 loopback Host，不接收 MCP 或 NewAPI 密钥。
Pi / DSH 共用同一世界会话，通过 `worldSessionId` 标识，禁止并行写入同一 Studio 世界。

## Pi / DSH 统一执行与验收

- `AgentExecution.js` 只抽取必要的工具名、操作、目标 ID、执行状态及 `scene_verify` 验收条件；不会保存生成的源代码或全部 LLM 对话。
- Pi 的 SDK 完成事件、DSH SDK 的 `tool/call` / `tool/result` 统一生成 `execution`；两个后端不再直接宣布 `completed`。
- TaskSpec.js 保留苹果树、房屋、杯子的确定性 Golden Tasks；TaskCompiler.js 对其他请求使用现有 NewAPI 模型配置尝试一次结构化编译（Pi/DSH 共用），TaskSchema.js 用 Zod 限制候选规格，Host 转换为现有 Runtime 验收条件。模型只能提出候选条件，不参与最终结果判定。
- `AgentHost` 在两种 SDK 结束之后调用同一个 `finalizeRun()`。存在已提交世界变更时，必须有晚于最后一次变更的显式 `scene_verify`。
- Host 使用受限 MCP **确认与任务执行时是同一世界会话（DSH 预先绑定；Pi 比对 SDK 会话），重新读取当前 Studio Scene Revision、重跑原始验收条件**，同时添加世界有效性与已添加实体存在性检查。前后版本不一致、证据过期、失败操作未恢复均返回 `incomplete`。
- 针对新建 Code Project，还必须确认项目 ID、`runningRevision`、实体注册及保存结果；项目源代码仍在浏览器 Studio 中执行，本改动**不提供 JavaScript 隔离**。
- 统一返回 `agentscape.agent-run` v1，保留 `taskStatus`、`execution`、`verification` 与 `unresolvedMutations`，并增加 `world`（worldSessionId、projectId、projectRevision、sceneRevision）。
- `run.finished` 只由 Host 在最终验收后发出，适用于普通 HTTP 与 NDJSON 事件流。

**验收范围**：本版严格验证 Agent 提交的明确后置条件及已知变更对象，不会将通用 `world-valid` 等同于用户自然语言任务的全部语义要求。视觉质量与未授权 Three.js 代码隔离分别属于后续工作；不得凭本结果声称已解决。
## 安全和已知限制

- `/agent-mcp` 是对原 `/mcp` 的服务端工具级白名单，含限定 MCP 兼容路由；`/mcp` 仍保留给原有 MCP 客户端。
- Pi 的工具均使用同一个 MCP 权限/校验路径；不向模型提供 Shell、原生文件系统或可信代码执行。
- DSH 的官方 SDK 子进程不等于沙箱。默认 profile 有宿主访问能力，必须验证补丁实际将这些工具禁用。
- 取消时不回滚已提交的世界操作；未知状态必须重新观察，不能盲目重发。
- **Pi/DSH Agent 的自然语言结束不是世界验证证据。** 无明确 Runtime 验证时返回 incomplete。
- DSH 使用本地模拟 NewAPI 与真实受限 MCP 做过工具调用端到端测试；尚未完成真实付费 NewAPI 模型和苹果树视觉验收。切换引擎本身不会提升有机资产的视觉质量。
- Agent Host 目前是 PC2 **本地开发服务**。正式远程部署需要端到端身份验证、CSRF 防护、TLS、任务流持久化与按世界粒度调度；不能仅将 loopback 端口公开到互联网。

## 验证

```powershell
npm run test:agent-host
npm run typecheck
npm run build
node_modules/.bin/dsh.cmd --profile sdk-minimal --patch apps/agent-host/dsh-restricted.patch.yml --dump-config
```

### 通用任务编译（第一阶段）

- 无需新增独立模型服务或 Agent Loop：在 Pi/DSH 执行前，Host 复用配置的 OpenAI-compatible AGENTSCAPE_LLM_* 请求一次 /chat/completions；已有 Golden Tasks 不再额外调用模型。默认 15 秒超时，可通过 AGENTSCAPE_TASK_COMPILER_TIMEOUT_MS 调整（1000–60000 毫秒）。仅配置 DSH、不提供这些模型参数时，未知任务保持 review-required。
- 每项需求包含源文本 quote，严格 Zod Schema 限定为 entity（数量展开）、relation（五种可验证空间关系）、action（必须有独立执行证据）、state、visual 或 unverifiable。Host 检查原文引用、显式数量、粗粒度文本覆盖、条件数量上限；不接受模型返回任意 scene_verify 参数。
- 无法解析、超时、超量或模型接口失败时回退为 review-required，不得自动报告完成。显式不可验证需求需要人工审核；视觉外观和颜色不当作 Runtime 状态，必须等待视觉验收机制，仍返回 VISUAL_REVIEW_PENDING。
- 原始 Golden Task 条件在合并时优先保留。AgentRunFinalizer 在同一世界修订上独立复验；模型声明 complete:true 不构成成功证据。
- **当前限制**：原文引用和文本覆盖比例不能严格证明模型没有遗漏语义；暂未加入第二模型交叉审核、人工任务规格确认 UI 或视觉评分。通用任务的完成状态只证明已列出、受 Runtime 支持的结构化条件，不能保证主观视觉品质。
- 可运行 npx vitest run tests/agent-host/task-compiler.test.js tests/agent-host/task-spec.test.js 验证新编译与旧任务回归。
