# 交互式世界运行时架构

## 目标

AgentScape 通过注入层把现有 Three.js 场景接入一个可观察、可交互、可受物理影响的世界运行时。宿主继续拥有 `Scene`、`Camera`、`Renderer`、材质、灯光、Shader、动画和后处理。AgentScape 负责实体身份、语义、交互、物理、空间查询、音频和生成任务之间的协调。

## 总体边界

```text
宿主 Three.js Scene
        ↓
NativeSceneHost
        ↓
EntityCapabilityRegistry  ← 稳定 entityId 与生命周期
        ↓
Semantic / Interaction / Physics / Spatial / Audio / Navigation / Generation
```

`ObjectStore` 仍然是 Runtime 资产实例的兼容存储。`EntityCapabilityRegistry` 是逐步统一宿主对象和 Runtime 对象身份的索引。两者暂时并存，避免破坏已有 WorldRuntime、SceneFacade、序列化和恢复调用方。

## 实体模型

每个可参与 AgentScape 行为的对象都有稳定 `entityId`，并在注册表中记录：

- `object`，对应宿主或 Runtime 的 Three.js `Object3D`
- `source`，当前为 `runtime` 或 `native`
- `assetId` 和已编译的 manifest
- `capabilities`，例如 `semantic`、`interaction`、`physics`、`articulation`、`audio-emitter`、`instrument`、`environment-audio`、`generation`
- `transformAuthority`，可取 `static`、`host`、`kinematic`、`physics`、`animation`、`articulated`
- 生命周期阶段，从 `created` 到 `active`，删除时经过 `removing` 和 `removed`

注册表只拥有身份和协调状态，不拥有宿主几何、材质、纹理、renderer 或音频资源。专业系统继续维护自己的索引，并使用同一个 `entityId` 关联。

## 生命周期事务

Runtime 资产生成和原生对象注入都遵循以下顺序：

```text
created
→ validated
→ visual-mounted
→ semantic-registered
→ physics-registered
→ spatial-registered
→ audio-registered
→ active
```

任一阶段失败时，已经创建的资源必须按逆序清理。删除实体时，交互任务、导航障碍、物理刚体、音频句柄和注册表记录必须一起清理。当前第一阶段已经覆盖视觉挂载、Runtime 物理注册失败回滚、Native 注入失败回滚和删除注销。

## GLB 交互和物理

```text
GLB
→ AssetCompiler
→ Manifest
→ 稳定 partId
→ 交互动作
→ 碰撞体与刚体定义
→ WorldRuntime.spawn
→ EntityCapabilityRegistry
→ PhysicsSystem / InteractionSystem
```

GLB 节点名称只作为编译输入，不能直接作为长期身份。编译器应输出稳定部件 ID、规范化路径和内容指纹。可交互动作必须在 manifest 中显式声明。自动推断只用于观察、定位、命中和接近点等低风险能力。

动态刚体必须有经过校验的质量和碰撞体。静态环境可以使用质量门禁后的包围盒或显式碰撞体。任意宿主 Mesh 不会被自动猜测为物理对象。

## Three.js 原生兼容

AgentScape 只把自己的根节点挂到宿主 Scene，不接管宿主 renderer、composer 或帧循环。宿主的原生材质、灯光、阴影、Shader、动画回调和后处理继续由宿主控制。宿主对象通过 `native.addComponent()` 接入身份和语义索引，默认变换权威为 `host`。

如果宿主对象需要物理、音频或专用交互能力，调用方必须显式声明能力，并提供对应模块要求的定义。能力注册不会自动改变材质，也不会自动释放宿主资源。

详细的 Three.js 兼容等级、版本策略和不变量见[原生 Three.js 注入架构契约](native-threejs-architecture.md)。

## 音频与乐器

音频能力独立于渲染层。宿主提供 `AudioContext`、`AudioListener` 和输出节点，未来 `AudioSystem` 以 `entityId` 管理空间发声体。

```text
输入事件
→ InteractionSystem
→ Instrument capability
→ AudioSystem.scheduleNote
→ 空间音频输出
→ 对象动画与状态更新
```

环境音乐由 `MusicDirector` 根据区域、环境标签、时间、天气、玩家状态和事件强度选择音乐状态。音乐系统不会修改 Three.js 渲染循环，所有音频资源都必须有明确 owner 和 dispose 路径。

## 实时生成

```text
用户指定位置
→ Raycast / Spatial Query
→ 命中点、法线和支撑面
→ GenerationOrchestrator
→ GLB 或资产制品
→ AssetCompiler
→ 交互与物理校验
→ 临时实体预览
→ 空间和碰撞验证
→ WorldRuntime 原子提交
```

每个生成任务需要 `requestId`、`operationId`、世界 revision、资产 hash、生成来源和取消状态。提交必须幂等，失败时不得留下 Object3D、刚体、音频句柄或实体记录。

## 当前实现与下一步

当前已实现：

- `EntityCapabilityRegistry` 统一记录 Runtime 与 Native 实体身份
- `WorldRuntime.spawn/remove/dispose` 的注册和逆向清理
- `NativeSceneHost.addComponent()` 的实体注册、冲突检查和回滚
- 生命周期与能力索引测试

后续按以下顺序扩展：

1. 把 manifest 的能力定义规范化为字段级契约，并补齐 GLB 部件身份和碰撞体质量门禁
2. 将拾取、推动、开关和关节动作映射为实体能力注册
3. 增加 AudioSystem、Instrument 和 MusicDirector
4. 增加基于命中点的生成预览和原子提交
5. 将实体索引接入快照、恢复、分区和多人同步

相关契约：

- [实体能力契约](entity-capability-contract.md)
- [GLB 交互物理管线](glb-interactive-physics-pipeline.md)
- [音频运行时与自适配音乐](audio-runtime-and-adaptive-music.md)
- [实时交互生成](realtime-interactive-spawn.md)
