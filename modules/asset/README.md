# Asset

负责资产编译、准入、发布、注册、加载、目录与资产库。入口：AssetModule.js。
模块不调度生成任务，不拥有 World 实例状态。

稳定边界：
- `AssetRegistry`：Asset Manifest identity / registration truth。
- `AssetLoader`：Asset → Three.js runtime object materialization；内部使用 `GltfAssetLoader` 与 built-in factories。
- `AssetCatalog`：基于 Registry 的查询、搜索与摘要。
- `LocalAssetLibrary`：持久化用户批准的 compiled assets。
- `publication/`：verified Artifact → Asset 的发布编排。
- `compiler/`：输入 → AgentScape 可接纳 Asset 表示。

`AssetModule` 明确暴露 `registry` 与 `loader`；registry 负责 manifest identity，loader 负责实例化与资源加载。
发布流程消费 Artifact 公共契约，重型几何服务仍位于 `services/asset-compiler`。

任务见 tasks.jsonl。验证：`npm run test:asset` 和 `npm run assets:validate`。
