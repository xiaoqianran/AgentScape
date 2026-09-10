# Generation

负责 Connector 能力发现、任务提交/查询/取消、任务投影与重连。
现有实现保留 connector/、jobs/、providers/；它们已有实际代码，不创建额外空层。

跨 Artifact、Asset、World 的协调已移至 application/generation。
远端任务状态是 Connector 事实的本地投影；断网与取消请求都不等于远端任务已经失败或取消。

任务见 tasks.jsonl。验证：npm run test:generation。
