# 可观察任务与安全取消

任务页用于选择任务和浏览运行记录。提交自然语言任务后进入现有世界编辑器的任务模式：保留同一个画布与 Runtime，右侧展示 TaskPanel 的目标、工具步骤、Runtime 确认变化与结果。任务／属性切换只改变面板，不创建另一份任务状态。选择 Runtime 对象后，输入区可明确绑定其真实 ID；用户可关闭绑定。聚焦当前目标由用户点击触发，不自动抢镜头。

`ToolCallingAgent.run(text, { signal })` 在观察前后、模型响应前后、每个工具执行前检查取消。运行中的世界工具使用原有有界导航／交互流程到达安全边界后返回，随后取消结果为 `taskStatus: cancelled` / `termination: user-cancelled`。执行账本保留已完成变化与未解决变更，不调用全局释放、回滚或丢弃持有物。

TaskPanel 发出取消后保持 busy，显示“正在取消”；Agent 确认退出后才显示“任务已停止”。重试创建新执行与 AbortController，重新调用 listObjects 和 taskObservation，不复用旧计划或缓存坐标。脚本 demo 与开发 Runtime 验收未接入本取消协议，界面明确标记运行中，不能当作可取消的自然语言任务。

取消信号经 HttpLLMGateway 的第二个参数进入 JsonGateway 的 fetch signal，不进入模型 JSON。浏览器断开 capability 请求时服务端中止适配器 fetch；自带 OpenAI gateway 将断连传播为上游 fetch signal，取消不触发 fallback model 或请求重试。对于第三方适配器和付费远端任务，这只证明请求已中止或已请求取消，不承诺远端 GPU 任务、账单或已提交 Generation Job 被撤销。

失败反馈展示 Runtime outcome 原因并建议检查对象、通路与支撑面；成功与失败仍由原有运行时验证判断。本改动不承诺任意时刻精确暂停／续跑、多任务并行或第三方服务确认取消。

自动回归入口：`tests/agent/task-cancellation.test.js`、`tests/contracts/capability-adapter-registry.test.js`、`tests/contracts/openai-compatible-agent-gateway.test.js`、`tests/studio/studio-react-store.test.js`。浏览器自动验收由 ACCEPTANCE-BROWSER 任务单独记录，不以静态渲染测试冒充用户流程。
