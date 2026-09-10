# World

负责世界描述与编译、实例状态、物理/导航/交互/仿真、变更保护与验证。
入口：runtime/WorldRuntime.js、compiler/createWorldPipeline.js。
spec/compiler/runtime/verification 等已有子系统保留，不按统一模块模板重新拆分。
生成世界坐标语义现在位于 generated/。

World 只消费限定的 Asset 契约，不调用 Provider。
当前 WorldRuntime 仍连接渲染与内部状态；编辑入口和结果证据的进一步封装需具体任务驱动。

任务见 tasks.jsonl。验证：npm run test:world 和 npm run world:viability。
