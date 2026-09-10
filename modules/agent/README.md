# Agent

负责模型交互、工具调用循环、提示上下文和恢复策略选择。
入口：ToolCallingAgent.js；模型传输位于 gateway/HttpLLMGateway.js。

产品 Skills、AgentTools 和跨域观察已归 application。Agent 消费传入的 tools/gateway，不反向导入 application。
恢复建议仍包含世界任务语义；不把算法复制进 UI，也不提前拆出 execution/context/recovery 模板目录。

任务见 tasks.jsonl。验证：npm run test:agent。
