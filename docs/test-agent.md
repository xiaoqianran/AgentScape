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
