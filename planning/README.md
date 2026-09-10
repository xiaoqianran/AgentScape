# Planning

每条任务只有一份权威记录，放在其主要所有者的 tasks.jsonl。planning/tasks.jsonl 只保留跨模块、仓库和集成任务，不是模块任务的副本。

## 文件发现

dev/planning.mjs 读取 planning/tasks.jsonl、application/tasks.jsonl，以及 modules、apps、sdk、services 的直接子目录中的 tasks.jsonl。不会扫描 node_modules、构建产物或更深层的副本。

```sh
npm run planning:validate
npm run planning:list
npm run planning:ready
```

聚合输出为 { source, task }，source 是原文件路径。Planning UI 应使用同一个读取接口；编辑时写回 source，而不是生成另一份总表。

## 字段

稳定字段顺序：id、type、title、status、priority、path、depends、files、criteria。保留既有可选 owner/evidence，不要求新增字段。

- id：全项目唯一、迁移或换分类时不变。
- type：feat/fix/refactor/perf/test/docs/build/ci/chore/revert/research。
- title：明确可观察的结果。
- status：保留现有 READY/IN_PROGRESS/BLOCKED/DISCOVERY/DEFERRED/DONE；也接受 TODO。此次迁移不批量修改原状态。
- priority：P0–P3。
- path：能力分类，不随源码目录迁移而改写。
- depends：全项目任务 ID，可跨文件。
- files：仓库根目录相对路径；未知位置留空。
- criteria：验收条件。

Ready Queue 是状态为 READY 或 TODO 且所有依赖都 DONE 的任务。不是简单筛选 READY。

读取时检查格式、全局 ID、依赖缺失和环。未来编辑器保存必须检查读取版本、串行化写入并原子替换，防止覆盖其他编辑者。当前提供读取与校验 CLI，没有宣称 UI 编辑已经实现。

## 归属

领域改进归模块，跨领域产品用例归 application，UI/HTTP 入口归 apps，SDK/独立服务就近维护。一次任务只选一个主要所有者，协作关系用 depends 表达。

现有 1152 条任务全部保留原 ID、状态、分类和依赖，仅拆分存放并更新 files。README 不再维护第二份任务进度。
