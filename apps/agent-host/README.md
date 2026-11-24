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
- 默认 world 模式下，AgentHost 直接把原始用户需求发送给 Pi/DSH，不预先调用 TaskSpec/TaskCompiler，不强制指定预编译对象 ID 或固定关系。只有启用 strict 模式才加载 TaskSpec 与 TaskCompiler，并将模型候选要求用于独立语义验收。
- `AgentHost` 在两种 SDK 结束之后调用同一个 `finalizeRun()`。存在已提交世界变更时，必须有晚于最后一次变更的显式 `scene_verify`。
- Host 使用受限 MCP 确认任务前后是同一世界会话（DSH 预先绑定；Pi 比对 SDK 会话），重新读取当前 Studio Scene Revision、验证 Agent 声明的后置条件；strict 模式还会复核额外编译的用户需求条件。世界有效性与新增实体存在性始终纳入检查，证据过期、失败操作未恢复均返回 incomplete。
- 针对新建 Code Project，还必须确认项目 ID、runningRevision 及保存结果。默认 world 模式允许没有注册语义实体的纯 Three.js Scene；需要验证具体交互或 strict 任务条件时仍需可观察的实体/动作证据。本改动不提供 JavaScript 沙箱隔离。
- 统一返回 `agentscape.agent-run` v1，保留 `taskStatus`、`execution`、`verification` 与 `unresolvedMutations`，并增加 `world`（worldSessionId、projectId、projectRevision、sceneRevision）。
- `run.finished` 只由 Host 在最终验收后发出，适用于普通 HTTP 与 NDJSON 事件流。
- Pi 的 `model.turn` 事件记录真实模型停止原因、工具调用数与服务端报告的 Token 用量，不保存内部推理内容；`usage` 累计所有 Pi 创作及视觉修订轮次的模型调用量，`reportedCalls` 明确多少次具有真实用量。视觉模型调用用量在 `visual.reviews[].usage` 单独记录。没有供应商价格时不估算费用。
- `scene_verify` 只接受可由当前场景直接验证的条件；`no-unresolved` 需要完整 Agent 执行日志，由 Host 独立检查，不能作为 Scene 断言。执行记录保留失败验收项的有界 ID、kind 与原因码，避免只有笼统的 SCENE_UNVERIFIED。
- 对 Host 绑定的新建项目，模型输出截断或完全空响应时最多追加一次针对同一项目的恢复请求，鼓励小而完整的源码文件/补丁；仍失败则拒绝验收。对于已经验证支持对应参数的 NewAPI 路由，可设置 `AGENTSCAPE_LLM_DISABLE_THINKING=1`（`chat_template_kwargs.enable_thinking=false`）与 `AGENTSCAPE_LLM_STREAM_USAGE=1`（`stream_options.include_usage=true`）。视觉评价可单独配置 `AGENTSCAPE_VISUAL_DISABLE_THINKING=1`，同模型默认继承创作开关。

**验收范围**：默认 world 模式仍复核当前 Studio 世界会话、项目运行修订、Agent 声明的 scene_verify 条件、变更实体存在性和 world-valid；未通过真实检查不能冒充成功。返回的 verification.scope 为 world-state，不代表用户语言中的全部要求或视觉质量已经验收。strict 模式额外要求 TaskSpec 条件，scope 为 task-criteria；视觉模型评价单独通过 `visual` 字段呈现，未通过时不宣称整个任务已完成。
### 默认视觉反馈与自动修订（Studio Code Project）

- 对**新建代码世界**，默认 `AGENTSCAPE_VISUAL_REVIEW_MODE=auto`：Pi/DSH 写入、运行、保存并通过世界状态验收后，Host 通过 `studio_project(operation=capture)` 取得当前 Studio WebGL 真实帧（JPEG，最大 768×432，base64 上限 240000 字符）。不生成替代性示意图。
- Host 使用现有 OpenAI-compatible 模型端点发送截图和原始用户要求，对格式不合规或输出截断最多重试一次（同一已验证画面、总超时不延长），要求 JSON 形式返回 `accepted`、0–10 评分、可见问题及具体源码修订建议。默认沿用 `AGENTSCAPE_LLM_MODEL`；可用 `AGENTSCAPE_VISUAL_MODEL` 指定**具备图像输入能力**的模型；`AGENTSCAPE_VISUAL_TIMEOUT_MS` 缺省 30000。
- 若视觉模型评价为不合格，Host 向原 Pi/DSH 后端再提交一次包含反馈的修订任务；Agent 继续使用当前 Studio 项目（原项目 ID 和世界会话），写代码、运行、保存、`scene_verify`，然后重新截图评价。默认 `AGENTSCAPE_VISUAL_MAX_REVISIONS=2`（最多 3 次视觉评价和 2 次源码修订，可配置 0–3）。
- `AGENTSCAPE_VISUAL_REVIEW_MODE=on` 对编辑已有运行中代码世界的已完成任务也启用视觉评价；`off` 禁用。`auto` 只针对 Host 新建的代码世界，不对所有非视觉操作收费。
- Host 新建代码世界的最终验收要求最后一次场景修改（包括撤销/重做）之后成功保存。`savedCheckpoint` 记录项目 ID、源码修订、独立 Runtime ID、场景修订和保存内容 SHA-256；缺失或与实时独立验收不一致时拒绝完成。它是本机保存证据，并不表示已发布到共享仓库。共享发布仍需用户明确操作。
- 截图及评分绑定 `worldSessionId`、`projectId`、`runningRevision`、`runtimeId`、`sceneRevision`。模型调用之前必须与 Host 刚通过的世界验收一致，返回后再次检查；即使重跑相同源码、数字修订碰巧相同，也不能复用上一 Runtime 的评价。JPEG 只发送给选定的模型端点，不出现在 NDJSON 事件/运行日志中；事件只提供轮次、评分和修订摘要。
- `visual.status=passed` 表示**模型对可见画面的主观评价通过**，不是客观视觉质量保证，也不代表物理和交互真实完成；后者仍由原有 Finalizer 独立验证。截图不可用、模型不支持图像、修订号变化或修订次数用尽时，任务返回 `incomplete`、`verified:false` 并注明原因，不会伪装成功。

```powershell
# 可选：为视觉评价单独选用支持图像输入的模型
$env:AGENTSCAPE_VISUAL_MODEL = 'your-vision-capable-model'
$env:AGENTSCAPE_VISUAL_MAX_REVISIONS = '2'
$env:AGENTSCAPE_VISUAL_REVIEW_MODE = 'auto'
npm run agent:stack
```

自动视觉闭环使用默认的自由 Three.js 运行路径，无额外人工批准或固定对象词表。**该功能会增加视觉模型 API 调用费用**。本地测试覆盖真实 Chromium 截图、MCP 图片传输与模拟多模态模型驱动的反复修订；真实付费模型的效果和复杂场景视觉质量仍需另行评测。
## 安全和已知限制

- `/agent-mcp` 是对原 `/mcp` 的服务端工具级白名单，含限定 MCP 兼容路由；`/mcp` 仍保留给原有 MCP 客户端。
- Pi 的工具均使用同一个 MCP 权限/校验路径；不向模型提供 Shell、原生文件系统或可信代码执行。
- DSH 的官方 SDK 子进程不等于沙箱。默认 profile 有宿主访问能力，必须验证补丁实际将这些工具禁用。
- 取消时不回滚已提交的世界操作；未知状态必须重新观察，不能盲目重发。
- **Pi/DSH Agent 的自然语言结束不是世界验证证据。** 无明确 Runtime 验证时返回 incomplete。
- DSH 使用本地模拟 NewAPI 与真实 MCP 做过工具调用端到端测试。新增视觉回路已验证真实 Studio WebGL、MCP 截图与模拟图像模型驱动的源码再运行；**尚未完成真实付费视觉模型的苹果树质量评测**。切换引擎本身不会提升有机资产的视觉质量。
- Agent Host 目前是 PC2 **本地开发服务**。正式远程部署需要端到端身份验证、CSRF 防护、TLS、任务流持久化与按世界粒度调度；不能仅将 loopback 端口公开到互联网。

## 验证

```powershell
npm run test:agent-host
npm run typecheck
npm run build
node_modules/.bin/dsh.cmd --profile sdk-minimal --patch apps/agent-host/dsh-restricted.patch.yml --dump-config
```

### 可选严格任务编译

- 默认 AGENTSCAPE_TASK_ACCEPTANCE_MODE=world（或留空）直接执行用户要求，不调用 TaskCompiler。显式设置 AGENTSCAPE_TASK_ACCEPTANCE_MODE=strict 时才额外编译任务，复用已有 OpenAI-compatible 模型接口，Golden Tasks 无需再次调用模型。超时默认 15 秒，可由 AGENTSCAPE_TASK_COMPILER_TIMEOUT_MS 调整；模型不可用或语义不确定时，仅严格模式会转为 review-required。无效模式会明确报错而不会静默关闭验收。
- 每项需求包含源文本 quote，严格 Zod Schema 限定为 entity（数量展开）、relation（五种可验证空间关系）、action（必须有独立执行证据）、state、visual 或 unverifiable。Host 检查原文引用、显式数量、粗粒度文本覆盖、条件数量上限；不接受模型返回任意 scene_verify 参数。
- strict 模式下无法解析、超时、超量或模型接口失败时回退为 review-required；只有视觉回路未启用或不可用时，视觉外观才会维持未验收状态。默认 world 模式不因无法表达的关系或外观要求阻止 AI 运行，但不能把已验证的世界状态声称为全部自然语言需求完成。
- 原始 Golden Task 条件在合并时优先保留。AgentRunFinalizer 在同一世界修订上独立复验；模型声明 complete:true 不构成成功证据。
- **当前限制**：原文引用和文本覆盖比例不能严格证明模型没有遗漏语义；暂未加入第二模型交叉审核或人工任务规格确认 UI。视觉评分已由单个可选视觉模型提供，不应当作独立于该模型的客观验收。通用任务的完成状态只证明已列出、受 Runtime 支持的结构化条件，不能保证主观视觉品质。
- 可运行 npx vitest run tests/agent-host/task-compiler.test.js tests/agent-host/task-spec.test.js 验证新编译与旧任务回归。

### TaskCompiler 真实模型诊断与配置

- 对 NVIDIA Nemotron 3.5 系列，编译请求自动传入 chat_template_kwargs.enable_thinking=false；这只影响任务规格解析，不改变 Pi/DSH 正式 Agent 的推理设置。官方 NIM 文档表明推理开启时 max_tokens 可能全耗在 reasoning 而导致 content 为空。
- 通过 AGENTSCAPE_TASK_COMPILER_MODEL 可覆盖仅用于任务编译的模型 ID；AGENTSCAPE_TASK_COMPILER_DISABLE_THINKING=1 可为其他兼容模型显式关闭思考。不向未知模型自动发送该模型专属参数。
- 当模型返回 finish_reason=length 且没有可用完成结果时拒绝验收，不允许将 reasoning_content 当成任务 JSON。默认 15 秒超时保持不变。
- TaskCompiler 输出只保留白名单内的 diagnosticCode（如 TASK_COMPILER_TIMEOUT、TASK_COMPILER_OUTPUT_TRUNCATED、TASK_COMPILER_SCHEMA_INVALID），不保存模型响应正文、API Key 或链路详情。
- 真实模型可能将“四个轮子”错误解释为 wheel_count=4，或将“车门能够打开”解释成 door_openable=true。编译器明确拒绝这类将实体/动作要求替换成普通属性的情形。源文覆盖率不能证明所有语义都已理解，必须继续建设更系统的需求完整性验收。
真实模型评估见 docs/agent-task-compiler-evaluation.md；可使用 node dev/evaluate-task-compiler.mjs 复测。
