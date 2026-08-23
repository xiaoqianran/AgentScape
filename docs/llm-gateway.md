# LLM Gateway 协议

GitHub Pages 是静态前端，因此 AgentScape 不直接保存模型 API Key。浏览器只向用户配置的 Gateway 发送 provider-neutral 请求。

## 请求

```http
POST <gateway-endpoint>
Content-Type: application/json
```

```json
{
  "messages": [
    { "role": "user", "content": "把杯子放到桌上，然后打开柜子" }
  ],
  "tools": [
    {
      "name": "place",
      "description": "使用空间检测把对象放到支撑面。",
      "parameters": {
        "type": "object",
        "properties": {},
        "required": []
      }
    }
  ],
  "context": {
    "world": []
  }
}
```

工具定义由 SkillRegistry 动态导出，不维护第二份 Tool Catalog。

## 请求工具调用

```json
{
  "toolCalls": [
    {
      "id": "call_1",
      "name": "place",
      "args": { "id": "cup_01", "targetId": "table_01" }
    }
  ]
}
```

## 完成任务

```json
{
  "final": true,
  "message": "杯子已放到桌上。"
}
```

Gateway 可以连接 OpenAI、Anthropic、Gemini 或本地模型，只需把供应商原生 tool-calling 格式转换成上面的轻量协议。

## 多轮 Tool Call History

Gateway 协议中的 assistant message 可以携带：

```json
{
  "role": "assistant",
  "content": "",
  "toolCalls": [
    { "id": "call_1", "name": "navigateTo", "args": { "id": "agent_01", "end": [3,0,2] } }
  ]
}
```

下一条 tool result 使用同一个 `toolCallId`。这样 OpenAI-compatible adapter 可以恢复原生 `assistant.tool_calls → tool.tool_call_id` 顺序，不需要猜上一轮调用参数。

本地/VPS 可直接使用仓库内置测试适配器，见 [`test-agent.md`](./test-agent.md)。真实 API Key 只能放 `.env.local`，不能放 Browser/Pages。
