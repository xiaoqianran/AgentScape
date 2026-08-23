# 内置测试 Agent：OpenAI-Compatible Local Gateway

AgentScape 1.15.1 增加一个**只用于本地/VPS测试**的 OpenAI-compatible Agent Gateway。

目标不是把模型 API Key 放进前端，而是让真实 ToolCallingAgent 可以安全地测试外部模型：

```text
AgentScape Browser / ToolCallingAgent
             │
             │ provider-neutral protocol
             ▼
http://127.0.0.1:8788/agent
             │
             │ Bearer token only exists here
             ▼
OpenAI-compatible /v1/chat/completions
```

## 1. 当前默认测试模型

默认：

```text
nvidia/nemotron-3.5-lightning-30b-a3b
```

备用：

```text
meta/muse-glimmer-30b
```

默认 upstream base 已内置在本地测试脚本中，也可以通过环境变量覆盖。

API Key **永远不进入仓库**。

## 2. 密钥规则

仓库跟踪：

```text
.env.local.example
```

本机/VPS 私有：

```text
.env.local
```

`.env.local` 已加入 `.gitignore`。

建议权限：

```bash
chmod 600 .env.local
```

绝对不要把真实 Key 放到：

```text
src/
public/
README
localStorage
Vite VITE_* 环境变量
GitHub Pages bundle
commit message
测试快照
```

原因很简单：GitHub Pages 是公开静态前端，任何被打包进浏览器的 Secret 都等于公开。

## 3. 本地配置

复制：

```bash
cp .env.local.example .env.local
```

填写：

```text
AGENTSCAPE_TEST_LLM_API_KEY=<your-secret>
```

默认配置：

```text
AGENTSCAPE_TEST_LLM_MODEL=nvidia/nemotron-3.5-lightning-30b-a3b
AGENTSCAPE_TEST_LLM_HOST=127.0.0.1
AGENTSCAPE_TEST_LLM_PORT=8788
```

切换备用模型只改：

```text
AGENTSCAPE_TEST_LLM_MODEL=meta/muse-glimmer-30b
```

然后重启 Gateway。

## 4. 启动

终端 A：

```bash
npm run agent:gateway
```

默认：

```text
http://127.0.0.1:8788/agent
```

终端 B：

```bash
npm run dev
```

在 AgentScape 的 `LLM Gateway` 输入：

```text
http://127.0.0.1:8788/agent
```

浏览器只知道这个 loopback URL；不知道 upstream Key。

## 5. 一键 live probe

```bash
npm run agent:probe
```

Probe 会：

```text
ToolCallingAgent
      ↓
HttpLLMGateway
      ↓
ephemeral loopback proxy
      ↓
真实模型
      ↓
native tool_call
      ↓
模拟 navigateTo result
      ↓
第二轮模型收尾
```

它默认监听操作系统分配的临时端口，不和常驻的 `8788` Gateway 冲突。

此命令需要：

```text
.env.local
真实 API Key
外网
```

所以**不进入 CI**。

CI 只跑不需要 Secret 的 adapter/unit tests。

## 6. 为什么不能让浏览器直接请求模型 API

下面这种实现被明确禁止：

```text
Browser
  │
  ├─ Authorization: Bearer <secret>
  │
  ▼
Model API
```

即使 Key 只存在 localStorage，页面脚本、浏览器扩展、XSS 或用户导出的 profile 都可能读取它。

AgentScape 原本的架构就是：

```text
Browser
→ provider-neutral Gateway
→ provider credentials
```

1.15.1 只把一个可直接用于测试的 Gateway 实现补齐，没有改变这个安全边界。

## 7. Origin 安全

本地 Gateway 绑定：

```text
127.0.0.1
```

但仅绑定 loopback 还不够。

如果返回：

```http
Access-Control-Allow-Origin: *
```

那么用户访问的任意恶意网页都可能尝试调用：

```text
http://127.0.0.1:8788/agent
```

并借用本地 Gateway 中的 API Key 消耗 upstream 服务。

因此默认只允许浏览器 Origin：

```text
http(s)://localhost:<any-port>
http(s)://127.0.0.1:<any-port>
http(s)://[::1]:<any-port>
```

CLI/Node 请求没有 `Origin`，允许。

额外 Origin 必须显式配置：

```text
AGENTSCAPE_TEST_LLM_ALLOWED_ORIGINS=https://trusted.example
```

多个用逗号分隔。

外部 Origin 在调用 upstream 之前直接：

```text
403 Origin not allowed
```

测试同时要求 upstream `fetch` 根本没有发生。

## 8. Provider-neutral → OpenAI tool schema

AgentScape 的唯一 Tool Catalog 仍来自：

```text
SkillRegistry.definitions()
```

内部格式：

```json
{
  "name": "navigateTo",
  "description": "...",
  "parameters": {
    "type": "object"
  }
}
```

Adapter 转为：

```json
{
  "type": "function",
  "function": {
    "name": "navigateTo",
    "description": "...",
    "parameters": {
      "type": "object"
    }
  }
}
```

没有维护第二份工具定义。

### Current world context

`ToolCallingAgent` 每个 planning round 还会附带：

```text
context.world = current listObjects snapshot
```

Adapter 会把它转换成额外的 system context，并明确标记：

```text
read-only request context
tools remain authoritative
```

它每轮重新计算，不持久化，也不替代 Tool result。这样 OpenAI-compatible 模型不会因为 adapter 丢字段而失去 AgentScape Gateway 原本的 context 语义。

## 9. Tool-call conversation history

OpenAI-compatible 多轮 tool calling 要求历史顺序：

```text
user
↓
assistant.tool_calls
↓
tool(tool_call_id)
↓
assistant
```

旧 AgentScape provider-neutral conversation 只保留 tool result，没有把上一轮 assistant tool call 写回 messages。

1.15.1 修正为：

```json
{
  "role": "assistant",
  "content": "",
  "toolCalls": [
    {
      "id": "call_1",
      "name": "navigateTo",
      "args": {
        "id": "agent_01"
      }
    }
  ]
}
```

Adapter 再转换成原生：

```text
assistant.tool_calls
```

这避免第二轮形成 orphan tool result，也让模型真正知道上一轮自己调用过什么参数。

## 10. Tool arguments fail closed

模型返回：

```text
function.arguments
```

必须是合法 JSON object。

如果模型输出 malformed JSON：

```text
{broken
```

Gateway 明确失败：

```text
Model returned invalid JSON arguments
```

不会偷偷：

```text
args = {}
```

继续执行一个已经失去原始意图的工具调用。

## 11. 当前真实兼容性验证

在 2026-08 的本地验证中：

```text
GET /models
→ HTTP 200
```

两个测试模型都真实存在。

两者均通过：

```text
round 1
native message.tool_calls

round 2
assistant.tool_calls
+ tool result
→ normal final answer
```

因此它们不是“文本模拟函数调用”。

### AgentScape 小型 Tool Selection Smoke

使用当前 SkillRegistry Tool Catalog，做三个首工具选择任务：

```text
1. cup → table
2. physically navigate agent
3. diagnose a possibly blocked route
```

结果：

```text
nvidia/nemotron-3.5-lightning-30b-a3b   3 / 3
meta/muse-glimmer-30b                   1 / 3
```

Nemotron 正确直接选择过：

```text
navigateTo
suggestNavigationActions
```

Muse 在后两项首轮先选择了 `listObjects`。

这只是一个**很小的 AgentScape tool-selection smoke**，不能解释为通用能力排名；所以 Muse 仍保留为 alternate，而不是被删除。

## 12. 真实 AgentScape live probe

当前默认 Nemotron 的完整 Probe 已真实通过：

```text
goal:
Move agent_01 physically to [3,0,2]. Do not teleport it.

model tool call:
navigateTo(
  id = agent_01,
  end = [3,0,2]
)

simulated tool result:
status = arrived

model final:
normal completion
```

执行用了多轮 planning，而不是直接生成最终文本。

## 13. 为什么不把 Provider Adapter 塞进 Browser Runtime

OpenAI-compatible 转换器现在放在：

```text
scripts/openai-compatible-agent-gateway.mjs
```

而不是：

```text
src/agent/gateway/OpenAIProvider.js
```

原因：

```text
Browser Runtime
不应该拥有 provider credential responsibility
```

`src/agent/gateway/HttpLLMGateway.js` 继续只认识 AgentScape 的 provider-neutral Gateway。

这样将来 Anthropic / Gemini / internal gateway 仍不需要污染 Runtime。

## 14. 当前命令

```bash
# deterministic, no secret
npm test -- tests/openai-compatible-agent-gateway.test.js
npm test -- tests/tool-calling-agent-history.test.js

# live server, requires .env.local
npm run agent:gateway

# live end-to-end probe, requires .env.local
npm run agent:probe
```

## 15. 当前不做

本测试 Gateway 不负责：

```text
生产级用户认证
rate limiting
billing
shared multi-user deployment
secret vault
HTTPS termination
provider failover
model router
long-term conversation storage
```

它的责任只有一个：

> 在不把 Secret 暴露给 Browser/Pages 的前提下，让 AgentScape 可以真实测试 OpenAI-compatible tool-calling models。

## 16. 1.16 Embodied Interaction Probe

除了默认 locomotion probe，现在可运行：

```bash
npm run agent:probe -- interaction
```

目标要求模型：

```text
Walk agent_01 to cabinet_01 and open its door.
Do not open it remotely; use the embodied interaction abstraction.
```

Probe 明确拒绝低层 `open`，成功标准是模型最终调用 `approachAndInteract`。Nemotron 与 Muse 都已在真实 upstream 上成功选择该高层工具，并正确区分：

```text
interaction-requested
!=
joint settled
```

这是 behavioral smoke，不是确定性模型排名；同一模型不同 run 可能先尝试一个不合适的纯 `navigateTo`，Runtime/Probe 会拒绝错误路径并让模型纠正。

默认 Probe 静默；需要完整 plan/tool trace 时：

```bash
AGENTSCAPE_TEST_LLM_TRACE=1 npm run agent:probe -- interaction
```

## 17. 1.17 Agent Carry Probe

```bash
npm run agent:probe -- pickup
```

Probe 禁止模型调用低层 Human `pickup`，要求最终使用 `approachAndPickup`。当前 Nemotron 与 Muse 都真实通过，并在 pickup 后调用 `getCarryStatus`。返回 contract 明确 `attachment=kinematic-anchor`、`graspVerified=false`。详见 [`agent-carry.md`](./agent-carry.md)。

## 18. 1.18 Agent-held Place Probe

```bash
npm run agent:probe -- place
```

Probe 假定 `agent_01` 已持有 `cup_01`，但不把 held ownership 塞进 `listObjects`；模型可通过 `getCarryStatus` 查询。低层 scene `place` 会被拒绝，成功必须调用 `approachAndPlace(actorId,supportId)`。当前 Nemotron 与 Muse 都已真实通过 `approachAndPlace` probe；planning steps 会随采样波动，不作为稳定能力指标。成功标准始终是最终选择高层 `approachAndPlace`，并只在 `status=placed + supportVerified=true + settled=true` 后宣布成功。

## 19. 1.19 Live Articulation Completion Probe

`npm run agent:probe -- interaction` 现在返回最终 live completion，而不是旧 `interaction-requested`。成功 mock 与真实 Runtime contract 对齐：

```text
status = action-completed
targetReached = true
settled = true
coordinate ≈ target
error <= tolerance
```

Nemotron 与 Muse 都已真实通过 interaction completion probe；具体 planning steps 会随采样波动，不作为能力判断。Nemotron 某些 run 会先尝试不合适的纯 `navigateTo` 再纠正，Muse 常见先 `findInteractionPose` 预览。成功标准始终是最终调用 `approachAndInteract`，并且只在 completion contract 成立后宣布 Door 已打开。新的 `getArticulationStatus` 只用于失败诊断或后续状态查询，成功后不需要冗余调用。详见 [`live-articulation.md`](./live-articulation.md)。

## 20. 1.20 Verified Multi-step Sequence Probes

成功链：

```bash
npm run agent:probe -- sequence
```

要求实际执行的 world mutation 顺序严格为 `approachAndInteract → approachAndPickup → approachAndPlace`，允许中间只读查询；最终必须 `taskStatus=completed` 且无 unresolved mutation。当前 Nemotron 与 Muse 都真实通过。

失败链：

```bash
npm run agent:probe -- sequence-failure
```

`approachAndInteract` 固定返回 `action-failed / STALL`。Probe 要求后续绝不执行 pickup/place，最终 `taskStatus=incomplete` 且 unresolved open failure 仍存在。Nemotron 当前样本会做 `listRelations` 后停止；Muse 的真实 failure probe 曾暴露 read-only 诊断循环；1.21 已把它变成 deterministic bounded recovery：compact context 内嵌 live articulation evidence，read-only recovery rounds 超过预算后返回 `recovery-observation-limit`。planning step 数仍不作为模型排名指标。

仓库还有不经过 LLM mock 的 `tests/agent-multistep-e2e.test.js`：它用真实 LocalPlanner、SkillRegistry、Navigation、Locomotion、Rapier 与 InteractionSystem 跑完整 open→pickup→place；另一条真实 Door blocker 场景证明 STALL 后 mutation history 只有 `approachAndInteract`。

## 21. 1.21 Compact Task Observation / Recovery Probe

现有 `sequence / sequence-failure` probe 同时覆盖 1.21，因为 ToolCallingAgent 每轮都会向 Gateway 注入 `context.task`。首轮保留完整 world entity index；发生 mutation 后 `context.world` 只保留对象数量与 `id/asset` entity index，相关 actor/object/articulation/unresolved evidence 位于 `agentscape.task-observation.v1`。

真实 Nemotron / Muse success sequence 仍保持 verified `open → pickup → place`。Failure sequence 必须满足：pickup/place 从未执行、`taskStatus=incomplete`、只有一个 semantic open failure 留在 unresolved ledger；模型若持续只读诊断，会以 `recovery-observation-limit` 受控结束，而不是无限读到全局 planning limit。

## 22. 1.22 Contact Provenance Attribution Probe

```bash
npm run agent:probe -- attribution
```

Probe world 只有 `agent_01 / cabinet_01 / obstacle_03`。模型必须直接使用 `approachAndInteract`；禁止手工 `navigateTo/findInteractionPose` 分解、低层 open、移动 blocker、pickup/place。模拟 STALL result 附 `current-contact-at-failure`，candidate 为 `obstacle_03`。Nemotron 与 Muse 严格版样本都能直接选择高层具身工具，并把 `obstacle_03` 表述为当前物理接触证据而不是唯一已证明根因。

## 23. 1.23 Verified Recovery Probe

```bash
npm run agent:probe -- recovery
```

严格 probe 要求模型先 `approachAndInteract` 得到 STALL + `obstacle_03` current-contact evidence，再调用 `suggestRecoveryActions`，执行返回的专用 `recoverPickupBlocker`，然后 fresh replan 并 retry 原始 `approachAndInteract`。禁止 `moveObject`、low-level open/pickup/place、manual navigateTo、以及直接 `approachAndPickup` blocker。Nemotron 与 Muse 当前样本都按 `open failed → suggestion → auxiliary recovery verified → original retry verified` 完成；sequence trace 要求 recovery 后 unresolved 仍为 1，只有原 open retry verified 后才变 0。planning step 数仍不作为稳定能力指标。

## 24. 1.24 Multi-candidate Recovery Ranking Probe

```bash
npm run agent:probe -- recovery-multi
```

Probe 同时返回 `obstacle_01 / obstacle_02` 两个 current-contact candidates，并故意让 obstacle_01 的 contact impulse 更大，但 pickup routeCost 为 5；obstacle_02 routeCost 为 2。`suggestRecoveryActions` 的 `ranking.causal=false` 且 recommended 为 obstacle_02。Nemotron/Muse 当前样本都只执行 rank-1 `recoverPickupBlocker(obstacle_02)`，随后立即 retry original open 并获得 `action-completed + targetReached + settled`。禁止先处理第二个 candidate 或把 ranking 解释成 causal proof。

## 25. 1.25 Verified Recovery Cleanup Probe

```bash
npm run agent:probe -- recovery-cleanup
```

严格双 blocker 场景要求：第一次 open STALL → rank-1 `obstacle_02` recovery → original retry 仍 STALL on `obstacle_01` while hands full → `suggestRecoveryActions.cleanupRecommended` → `cleanupRecoveryBlocker(obstacle_02)` 得到 `recovery-cleaned` → fresh `suggestRecoveryActions` → recover `obstacle_01` → final original open verified。禁止 `dropHeld / moveObject / navigateTo / direct approachAndPickup / approachAndPlace / low-level open/pickup/place`。Nemotron/Muse 当前样本都在 10 planning rounds 内完成；sequence trace 要求 cleanup 后 original unresolved 仍为 1，只有 final original action-completed 后才为 0。
