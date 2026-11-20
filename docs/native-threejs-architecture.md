# 原生 Three.js 注入架构契约

状态：当前架构决策

本文定义 AgentScape 作为 Three.js 注入层时的长期维护边界。具体实现和测试拥有最高优先级，本文用于解释设计意图、兼容等级和演进规则。使用方法见[原生 Three.js 集成指南](native-threejs-integration.md)。

## 目标

AgentScape 进入一个已经由宿主创建和驱动的 Three.js 项目，为宿主提供语义、组件、物理、导航和行为能力。宿主继续拥有原生场景、相机、渲染器、材质、灯光、Shader、后处理、动画循环和资源生命周期。

“原生”在这里指宿主对象继续使用宿主 Three.js 实例和原始渲染路径。AgentScape 不复制宿主对象，也不把宿主场景转换成另一种内部场景格式。

## 注入层位置

```text
宿主应用
  ├─ 创建 THREE.Scene / Camera / Renderer / Composer
  ├─ 创建 Mesh / Material / Light / Shader / Animation
  ├─ 驱动 controls、动画和 composer.render()
  │
  └─ attachNativeScene({ scene, camera, renderer })
       ├─ 校验 Three.js 构造器身份和宿主根变换
       ├─ 挂载 AgentScapeRoot 运行时子树
       ├─ 通过 native.addComponent() 注入宿主创建的 Object3D
       ├─ 通过 semantic 注册可发现实体
       ├─ 显式登记碰撞与导航几何
       └─ 由宿主帧循环调用 session.scene.frame(timestamp)
```

注入发生在 `THREE.Scene` 的子树层和 AgentScape Runtime 的语义层。渲染器包装发现属于可选的发现路径，不是显式接入的运行依赖。

## Ownership 契约

| 对象或能力 | 宿主项目拥有 | AgentScape 拥有 |
| --- | --- | --- |
| 根 `THREE.Scene`、相机、渲染器 | 创建、渲染、配置、销毁 | 只读绑定 |
| 宿主 Mesh、材质、纹理、Shader、灯光 | 创建、更新、释放 | 只读使用或显式组件挂载 |
| `AgentScapeRoot` 及其子树 | 不管理 | 创建、更新、移除、释放 |
| 语义实体注册 | 可通过 `semantic` 提供描述和读取函数 | 注册、查询、注销 |
| 物理和导航登记 | 通过显式参数提供来源 | 构建运行时表示并管理运行时资源 |
| Renderer、Composer、动画循环 | 完全拥有 | 不调用宿主 `render()` |
| Overlay 存档 | 保存宿主项目自己的身份和 root 引用 | 保存 AgentScape 实体、资产和运行状态 |

移除组件只解除挂载和语义注册，不会自动 `dispose()` 宿主的几何、材质或纹理。调用方仍然负责宿主资源释放。

## 兼容等级

### A 级，当前支持

- 同一份 Three.js 构造器创建 `Scene`、`Camera`、`Object3D` 和资源。
- 一个宿主 `Scene` 绑定一个 AgentScape Runtime。
- 宿主自行调用 `composer.render()`、`renderer.render()` 或其他既有渲染路径。`NativeSceneHost` 不安装 Three.js 全局原型补丁。
- 原生材质、`ShaderMaterial`、灯光、阴影、雾、InstancedMesh、`onBeforeRender` 和 OrbitControls 继续由宿主控制。
- AgentScape 运行时只通过 `nativeScene.add(world.scene)` 进入宿主场景。
- 碰撞和导航几何由 `walkableMesh`、`staticMeshes`、`colliders` 或 `navigationRoot` 显式提供。

### B 级，需专项验收

- 多相机和多视口。共享一个 Runtime，分别由宿主调用 `frame()` 后自行渲染。
- WebGL2、WebGPU、XR、OffscreenCanvas。当前仓库使用的 Three.js 版本不再支持 WebGL1，不能将 WebGL1 列入兼容承诺。
- EffectComposer 多 pass、RenderTarget、后处理中的深度和层级设置。
- 宿主根节点固定平移、旋转和统一缩放后的坐标适配。

这些场景可以设计适配器，但在加入浏览器测试矩阵前不能宣称全面支持。

### C 级，当前拒绝

- 不同 Three.js 构造器实例混用。
- 宿主 `Scene` 根存在非单位世界矩阵。
- 动态改变根节点的非均匀缩放或剪切。
- 自动扫描宿主全部 Mesh 并猜测物理、导航或语义。
- 让 AgentScape 接管宿主 renderer、composer 或动画循环。

拒绝这些输入是为了尽早暴露坐标、类型和资源所有权错误。兼容性问题必须通过明确适配器和测试解决，不能通过删除身份校验解决。

## Three.js 版本策略

发布包把 `three` 声明为 peer dependency，由宿主项目提供唯一实例。仓库开发和构建仍使用锁定版本。`attachNativeScene()` 在运行时检查传入构造器与 AgentScape 构建时使用的构造器身份和 `REVISION`。

Three.js 升级必须同时完成以下工作：

1. 更新仓库开发依赖和锁文件。
2. 运行类型检查、集成测试和真实浏览器测试。
3. 检查 `Scene`、`Camera`、`Object3D`、渲染器和后处理示例。
4. 记录新版本的支持结果和未覆盖能力。
5. 发布新的 SDK 版本，不能让宿主在无测试记录的情况下自动跨大版本升级。

身份检查是运行时防线，peer dependency 是安装时防线，两者必须同时保留。

## 生命周期和失败恢复

绑定流程先校验输入并预留 Scene，再初始化 Runtime。初始化任一步骤失败时，必须移除 AgentScape 子树、释放 AgentScape 自有资源并释放绑定预留，宿主场景保持可继续使用。关闭流程先停止新的 Runtime 变更，再注销语义组件、移除 AgentScape 子树并释放自有资源。

`frame(timestamp)` 只推进 AgentScape 状态。宿主帧循环负责调用顺序和最终渲染。`autoStart` 适用于没有既有循环的简单宿主，和宿主循环只能选择一种。

## 版本升级不变量

Three.js 内部实现可以变化，但以下公开不变量必须保持：

- 宿主 `Scene`、相机、renderer 和 composer 的对象身份不被替换。
- 宿主材质、Shader、灯光、动画回调和 render pass 不被修改。
- AgentScape 的运行时对象集中在独立根节点。
- 宿主关闭 AgentScape 后可以继续渲染原场景。
- 宿主资源不会被 AgentScape 自动释放。
- 不兼容输入以稳定错误码失败。

如果未来实现需要修改这些不变量，必须新增版本化能力或显式适配器，并更新本文和浏览器验收矩阵。

## 验收矩阵

当前真实浏览器验收位于 `tests/browser/native-scene.spec.js`，集成验收位于 `tests/integration/native-scene.test.js`。至少覆盖以下结果：

- Shader、材质、InstancedMesh、灯光曝光和宿主动画在注入前后保持有效。
- AgentScape 不调用宿主 renderer 的渲染入口。
- 组件和语义可以注入、查询、移除。
- 关闭注入层后宿主场景继续运行。
- 物理和导航使用显式登记的原生几何。
- Overlay 恢复不替换宿主对象。
- Three.js 实例不匹配和根变换不支持时不挂载任何 AgentScape 子树。

真实 GPU 输出、WebGPU、XR、OffscreenCanvas、动态根变换和非均匀缩放仍需要单独加入测试后才能提升兼容等级。

## 变更规则

涉及 `NativeSceneHost`、Three.js 依赖、渲染发现、原生组件、原生 Overlay 或 SDK 发布配置的变更，必须同步检查本文、[集成指南](native-threejs-integration.md)、类型声明和相关测试。文档描述当前实现时，以代码和测试结果为准，发现不一致应先修正文档或代码，不保留模糊表述。
