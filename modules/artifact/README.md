# Artifact

负责原始产物描述、内容完整性、注册、导入和持久化。入口：ArtifactModule.js。
Registry、ByteStore 与持久化装配由模块入口拥有；调用者不额外构造一套状态。
Artifact 完整性不代表 Asset 已准入，更不代表 World 中的动作已完成。

任务见 tasks.jsonl。验证：npm run test:artifact。
