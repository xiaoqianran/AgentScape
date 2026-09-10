# Planning UI

开发工具入口，当前仍为待实现的 UI，不属于产品模块。

数据来自所有者旁边的 tasks.jsonl。使用 ../planning.mjs 的 taskSources、loadPlanning 和 readyTasks 聚合，不仅读取根 planning/tasks.jsonl。

首版范围：Overview、Capability Tree、Ready Queue、Dependency Graph。
聚合条目保留 source；未来编辑必须写回唯一源文件并检查读取版本。UI 不拥有任务状态，不创建汇总 JSONL。
目前可通过 npm run planning:list 和 npm run planning:ready 使用同一数据模型。
