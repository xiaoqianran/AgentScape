# 资产（Asset）

`modules/asset` 负责把"已验证的 Artifact"变成 AgentScape Asset，并在之后把 Asset 实例化为 World 运行时对象。入口：`AssetModule.js`。

它不调度生成任务，也不拥有 World 实例状态。

## 结构

```text
asset/
├─ AssetModule.js        composition root
├─ model/                Asset 定义与有效性
├─ production/           Artifact → Asset 生产
├─ registry/             已知 Asset 元数据与查询
├─ loading/              Asset → 运行时对象
└─ persistence/          持久化本地 Asset 状态
```

## 边界

- `model/`：`AssetRef`、schema、parts、admission、资源预算、Asset 错误。无外部 I/O。
- `production/`：`AssetProductionPipeline`、compiler、compiler passes/providers、外部 payload adapters。这是唯一的 Artifact → Asset 路径。
- `registry/`：`AssetRegistry` 是 manifest 身份/注册真相；`AssetCatalog` 是其搜索/读取视图；内置 manifests 在此。
- `loading/`：`AssetLoader` 把已注册 Asset 解析为 Three.js 运行时对象；`GltfAssetLoader` 与内置 factories 是加载细节。
- `persistence/`：编译后的字节、持久化 manifests、以及用户批准的 `LocalAssetLibrary`。

## 生命周期

```text
Artifact
   ↓
production
   ↓
model validation / admission
   ↓
registry
   ├─→ persistence
   ↓
loading
   ↓
World Object
```

`AssetModule` 是 composition root，拥有 `AssetRegistry`、`AssetLoader`、persistence stores 与 Asset 生产配置。重型几何服务仍在 `services/asset-compiler`。

验证：`npm run test:asset`、`npm run assets:validate`、`npm run architecture:validate`。
