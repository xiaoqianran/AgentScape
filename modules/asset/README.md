# 资产（Asset）

## v2 声明式输入

`importRecipe(json)` 接收严格的 Asset Recipe v1：最多 64 个节点、4 层分组、box/sphere/cylinder、有限变换和标准材质（color、roughness、metalness，可选 opacity、emissive、doubleSided）。默认只请求 Visual；Physical/Interactive 必须显式声明物理与行为，声明经过现有 AssetCompiler 和 admission，不替代真实动作验证。复杂关节和高级源码继续走既有隔离构建入口。

`importGLB({bytes, level:'visual'})` 在加载前检查自包含 GLB，拒绝外部资源 URI、过多节点和非法层级，再执行现有编译器的几何与资源预算检查。该路径不依赖 Docker。请求 Physical 时明确拒绝，不推断碰撞或降级。Visual Manifest 无 physics/actions，WorldRuntime 不为其创建物理实体。

返回 `asset://sha256/<摘要>`、Manifest 和 admission。Recipe 摘要包含规范化定义与编译版本；修改定义产生新资产，已有实例不自动升级。`AssetInputContracts.js` 同时定义严格 Asset Package v1 数据结构，完整包依赖与跨设备迁移由保存阶段验收。

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

### Recipe 程序化纹理

`parts[].material.texture` 是有界的声明式 UV 纹理，不接受任意 Shader、URL 或外部文件。
支持 `wood`、`stone`、`fabric`、`brushed-metal`，例如：

```json
{"color":"#ffffff","roughness":0.75,"metalness":0,
 "texture":{"pattern":"wood","seed":42,"resolution":128,"frequency":1,
 "contrast":0.7,"normalStrength":0.25,"darkColor":"#775030","lightColor":"#cba06e"}}
```

生成的 Base Color PNG 与可选切线空间 Normal PNG 嵌入 GLB，支持现有资产编译器与标准 glTF 读取器；`normalStrength:0` 关闭法线图。`color` 仍是乘色因子，使用白色保留纹理原色。金属感、透明度等仍由现有 PBR 参数声明，不自动从纹理预设推导。分辨率仅允许 64、128、256；单个 Recipe 的唯一纹理声明累计最多 262144 像素（每组最多两张图）。相同规范化声明在一次编译内复用图片。纹理随已编译资产持久化，恢复时无需重新生成；这是近似程序纹理，不是实测材料或真实位移。
