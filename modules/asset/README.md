# Asset

负责资产编译、准入、发布、目录与资产库。入口：AssetModule.js。
保留 compiler/、pipeline/、storage/ 等已有实现；模块不调度生成任务，不拥有世界实例状态。
发布流程消费 Artifact 公共契约，重型几何服务仍位于 services/asset-compiler。

任务见 tasks.jsonl。验证：npm run test:asset 和 npm run assets:validate。
