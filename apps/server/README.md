# Server

服务端能力适配与模型代理。CapabilityAdapterRegistry.js 被根 api/capabilities 薄入口使用。
openai-compatible-agent-gateway.mjs 通过 npm run agent:gateway 启动；凭据保持在服务端环境。
不拥有浏览器 World 状态，浏览器模块不得导入本目录。

任务见 tasks.jsonl。验证：npm run test -- tests/contracts。
