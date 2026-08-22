# AgentScape LLM Gateway contract

AgentScape is deployed as a static GitHub Pages app, so provider API keys must not be embedded in the frontend. V0.6 sends tool-calling requests to a user-configured server endpoint.

## Request

`POST <gateway-endpoint>` with `content-type: application/json`:

```json
{
  "messages": [
    { "role": "system", "content": "..." },
    { "role": "user", "content": "把杯子放到桌上，然后打开柜子" },
    { "role": "tool", "toolCallId": "call_1", "name": "place", "content": "{...}" }
  ],
  "tools": [
    {
      "name": "place",
      "description": "Place an object on a target support surface...",
      "parameters": { "type": "object", "properties": {}, "required": [] }
    }
  ],
  "context": {
    "world": []
  }
}
```

## Response

To request tools:

```json
{
  "toolCalls": [
    { "id": "call_1", "name": "place", "args": { "id": "cup_01", "targetId": "table_01" } },
    { "id": "call_2", "name": "open", "args": { "id": "cabinet_01" } }
  ]
}
```

To finish:

```json
{
  "final": true,
  "message": "杯子已经放到桌上，柜子已打开。"
}
```

The gateway can use OpenAI, Anthropic, Gemini, a local model, or any other model. It is responsible for translating the provider's native tool-calling format to this small provider-neutral contract.

## Security

Keep model credentials on the gateway server. Configure CORS to allow the AgentScape Pages origin. AgentScape stores only the gateway URL in browser local storage; it does not ask for or persist provider API keys.
