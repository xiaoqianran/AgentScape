# Asset

负责资产编译、准入、发布、目录与资产库。入口：AssetModule.js。
保留 compiler/、publication/、storage/ 等实现边界；模块不调度生成任务，不拥有世界实例状态。
publication/ 负责 verified Artifact → Asset 的发布编排；compiler/ 只负责把输入编译为 AgentScape 可接纳的 Asset 表示。
发布流程消费 Artifact 公共契约，重型几何服务仍位于 services/asset-compiler。

任务见 tasks.jsonl。验证：npm run test:asset 和 npm run assets:validate。
