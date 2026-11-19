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

实体模型规划为每个可参与 AgentScape 行为的对象提供稳定 `entityId`，并在注册表中记录以下信息。示例中的能力名称包含后续阶段的规划。

- `object`，对应宿主或 Runtime 的 Three.js `Object3D`
- `source`，当前为 `runtime` 或 `native`
- `assetId` 和已编译的 manifest
- `capabilities`，例如 `semantic`、`interaction`、`physics`、`articulation`、`audio-emitter`、`instrument`、`environment-audio`、`generation`
- `transformAuthority`，可取 `static`、`host`、`kinematic`、`physics`、`animation`、`articulated`
- 生命周期阶段，从 `created` 到 `active`，删除时经过 `removing` 和 `removed`

注册表只拥有身份和协调状态，不拥有宿主几何、材质、纹理、renderer 或音频资源。专业系统继续维护自己的索引，并使用同一个 `entityId` 关联。

## 生命周期事务

Runtime 资产生成和原生对象注入的目标顺序如下。各路径目前已覆盖的阶段见当前实现。

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

AgentScape 默认将自己的根节点挂到宿主 Scene，宿主继续管理 renderer、composer 和渲染循环。宿主的原生材质、灯光、阴影、Shader、动画回调和后处理继续由宿主控制。宿主已有对象通过 `native.bindComponent({ id, object, semantic })` 原位接入身份和语义索引，默认变换权威为 `host`。对象必须位于宿主场景中，绑定、解绑和关闭均保留其父子关系。`native.addComponent()` 用于将对象加入指定父节点，移除时将其摘除。

音频能力可以通过组件接口的 `audio: true` 显式注册。宿主对象可通过 `bindComponent({ id, object, physics })` 显式接入静态或动态刚体，碰撞体采用与资产配方相同的盒形配置，变换权威交给物理系统。当前要求对象启用 `matrixAutoUpdate`，世界变换无缩放或剪切，调用方负责在绑定期间避免其他系统同时修改对象变换。解绑时释放刚体并保留宿主对象。组件可通过 `actions` 声明项目自定义动作，复用场景的发现、参数校验、执行和验证流程，解绑时一并注销。部件关节和内建物理交互能力仍需接入。能力注册不会自动改变材质，也不会自动释放宿主资源。

`physics` 例如 `{ body: 'dynamic', mass: 1, colliders: [{ shape: 'box', halfExtents: [0.2, 0.2, 0.2] }] }`，尺寸及可选 `translation` 采用对象局部坐标。

详细的 Three.js 兼容等级、版本策略和不变量见[原生 Three.js 注入架构契约](native-threejs-architecture.md)。

## 音频与乐器

音频能力独立于渲染层。宿主提供 `AudioListener` 和其持有的 `AudioContext`。当前 `AudioSystem` 以 `entityId` 管理空间发声体，`Instrument` 将命名音符映射到单音调度。交互事件需要调用方显式连接到乐器。

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

## 当前实现

以下状态以代码和测试为准。不同接入路径的能力范围可能不同。

- `EntityCapabilityRegistry` 已记录 Runtime 与 Native 实体身份、阶段和能力。`ObjectStore` 与实体注册表暂时并存。
- `WorldRuntime.spawn/remove/dispose` 和原生组件接口已接入实体注册和基础清理。`native.bindComponent()` 原位绑定宿主对象，`native.addComponent()` 管理新加入的对象。
- Runtime 资产已有 GLB 编译、manifest、物理和部分交互流程。已存在的宿主 GLB 对象支持显式静态或动态刚体与盒形碰撞体，部件关节及交互流程仍需补齐。
- 已有 `AudioSystem` 空间单音调度和 `Instrument` 显式音符触发。当前乐器使用振荡器合成，音频交互的真实浏览器闭环和环境音乐尚待建设。
- `GenerationOrchestrator` 已有生成任务、取消、结果导入和资产编译等能力。根据场景命中位置预览并提交可交互物体的完整闭环仍需建设。
- 原生 Three.js 的部分材质、Shader、渲染循环和 Overlay 已有浏览器或集成测试。兼容范围以实际接口约束和测试结果为准。

## 后续阶段路线

以下规划分为七个阶段。阶段内按可独立验证的小步交付，测试、文档、类型声明和清理路径随每次改动同步完成。

### 第一阶段 稳定原生注入与实体生命周期

- 为已经存在于宿主场景的对象提供原位绑定路径，保留父子关系、局部与世界变换、动画和资源所有权。保留现有组件挂载接口的兼容行为。
- 明确实体 ID、对象绑定、能力注册、变换权威和生命周期之间的关系，处理重复绑定、部分失败、删除、关闭及重新绑定。
- 检查 Three.js 同一实例、根节点变换和宿主驱动循环等现有约束，并将可支持范围、诊断错误和测试矩阵保持一致。

完成标准为在真实浏览器中绑定、解绑和重复绑定已有的嵌套对象，宿主层级、变换、材质、动画和渲染循环保持预期，失败时资源和注册表状态可恢复。

### 第二阶段 接入宿主 GLB 与物理能力

- 复用现有资产编译、manifest 和物理系统，为宿主 GLB 根节点或指定部件建立稳定的实体与部件绑定。
- 通过明确的配置接入静态、运动学或动态刚体、碰撞体和质量等属性，明确宿主、动画与物理之间的变换控制权。
- 覆盖加载失败、物理注册失败、实体删除和宿主释放资源等生命周期；不从模型外观直接假定物理属性。

完成标准为真实 GLB 中选定的对象可注册物理能力，在重力和碰撞下按声明运动，解绑后物理资源被清理，原有视觉对象继续由宿主管理。

### 第三阶段 统一交互入口与实体能力

- 将可发现的语义、动作描述和现有交互执行路径关联到同一实体及其部件，复用已有拾取、放置、推动和关节动作能力。
- 为点击、输入、Agent 调用等入口提供一致的目标解析与动作结果，明确动作执行、失败、取消及资源清理的边界。
- 在宿主 GLB 和 Runtime 资产两条路径中检验能力声明与物理、导航、动画的协作。

完成标准为同一 GLB 的指定部件可以被发现、执行至少一种实际交互动作并产生可验证的物理或状态变化，错误和取消后实体状态保持一致。

### 第四阶段 完成乐器交互与真实音频闭环

- 复用 `Instrument` 和 `AudioSystem`，将显式交互动作连接到指定实体的发声能力，并保持音频上下文由宿主管理。
- 完善音符调度、取消、实体移除和上下文状态变化的行为。根据实际需求逐步扩展音源与资源管理。
- 在真实浏览器中验证用户手势、空间位置、播放结果和清理，补齐模拟音频节点测试未覆盖的行为。

完成标准为在宿主场景中与 GLB 乐器交互后产生可验证的空间声音，停止和移除后不残留本系统创建的音频节点，宿主音频上下文继续可用。

### 第五阶段 场景内实时生成与提交

- 复用 `GenerationOrchestrator` 的任务、取消、导入和编译能力，接入场景命中点、法线、预览与位置校验。
- 为生成结果建立请求身份、世界版本、来源和资产身份，处理重试、取消、重复提交及生成期间世界状态变化。
- 通过 Runtime 提交经验证的资产、交互定义和物理能力，失败时回收预览和已创建的资源。

完成标准为面向场景中的位置生成或导入一个物品，预览并提交后可与其交互；取消、失败和重试不会留下重复实体或孤立资源。

### 第六阶段 环境音频与自适配音乐

- 在实体音频能力之上引入环境状态和音乐编排，初期使用明确的区域、标签或事件输入驱动音乐状态。
- 定义音乐资源加载、复用、切换、淡入淡出、暂停和释放方式，保持宿主对音频上下文和主输出的控制。
- 覆盖区域切换、事件重叠、环境卸载和上下文暂停等情况，避免无限累积音频节点。

完成标准为进入与离开指定区域时，音乐按配置切换；反复切换和关闭场景后节点与资源得到正确释放。

### 第七阶段 持久化、兼容性与交付

- 记录并恢复实体能力配置、资产引用、交互状态和必要的物理状态，明确宿主对象由宿主恢复与重新绑定的责任。
- 扩展 Three.js 版本、浏览器、GLB 模型形态和长时间运行的兼容测试，并维护已支持能力与限制清单。
- 补齐公开接口、类型声明、示例、错误诊断、性能与资源回归检查；按项目实际需要评估分区和多人同步。

完成标准为受支持的场景经过保存、关闭、重新打开和重新绑定后，指定实体仍可按原配置交互；兼容测试和资源清理结果可重复验证。

相关契约包括以下文档。

- [原生 Three.js 注入架构契约](native-threejs-architecture.md)
- [实体能力契约](entity-capability-contract.md)
- [GLB 交互物理管线](glb-interactive-physics-pipeline.md)
- [音频运行时与自适配音乐](audio-runtime-and-adaptive-music.md)
- [实时交互生成](realtime-interactive-spawn.md)
