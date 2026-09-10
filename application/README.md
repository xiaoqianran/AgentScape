# Application

跨域工作现场：装配模块、注册产品 Skills、组装 Agent 观察，协调生成到资产再到世界的流程。

入口：createSession.js、skills/registerCoreSkills.js、generation/GenerationRuntime.js。
Studio 使用 createSession 创建 World、Asset、Generation 与 Skills；初始化顺序和宿主帧循环仍由 Studio 控制。
AgentTools 和 buildTaskObservation 放在这里，Agent 执行循环不需要知道各模块的内部装配。

generation/ 保留已有协调文件，不再属于 modules/generation。此处不拥有第二份资产或世界事实。
当前仍通过 world.generation/world.skills 连接既有代码；进一步缩小接口应按具体任务进行，不能仅靠搬文件宣称解耦完成。

任务见 tasks.jsonl。验证：npm run world:viability 与 npm run test。
