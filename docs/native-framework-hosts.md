# React / Vue 接入原生 Three.js（可信项目）

AgentScape 绑定的是运行中的 `THREE.Scene`、`Camera` 和 Renderer，**不要求 HTML 脚本入口**。React、Vue 和 React Three Fiber (R3F) 都可以使用显式的 `AgentScape.attach()`，但宿主必须负责自己的渲染器和组件生命周期。

本仓库提供两个真实运行示例，公共 Three.js 逻辑在 `examples/native-frameworks/createNativeWorldHost.js`：

- React：`/examples/native-react/`，使用 `useEffect`，含 `StrictMode` 双重挂载/清理验证。
- Vue 3：`/examples/native-vue/`，使用 `onMounted` 和 `onBeforeUnmount`，不需要 Vue 单文件组件编译插件。

执行 `npm run dev` 后访问这两个路径。示例保留宿主 Canvas、Renderer、地标和自己的 requestAnimationFrame；使用 `autoStart: false`，在宿主每帧显式推进 AgentScape 的 Scene。点击“仅卸载 AgentScape”后，原始渲染仍继续。

## 通用接入原则

```js
const session = await AgentScape.attach({
  scene, camera, renderer,
  autoStart: false,       // 由宿主帧循环驱动，不另外启动 RAF
  walkableMesh: floor,    // 必须是静态 Mesh，不会自动扫描所有 Mesh
  nativeObjects: [{
    id: 'host:lamp',
    object: lamp,
    label: '原生台灯',
    activate: () => lamp.toggle(), // 可信的宿主回调
  }],
});

// 宿主既有 RAF 或 R3F useFrame 中，保持每帧恰好一次：
session.scene.frame(timestampMs);

// 后续宿主新建对象时，可显式注册，卸载对象时显式注销：
session.scene.native.registerObject({ id: 'host:desk', object: desk });
session.scene.native.unregisterObject('host:desk');

// 仅撤除 AgentScape；外部 Object3D、Renderer、材质和动画不归它销毁。
session.close();
```

`scene.observe().nativeObjects` 返回已注册原生对象，`nativeInteractions` 显示可激活的对象。通过 `scene.interact({ actor, action: 'activate', target: 'host:lamp' })` 可执行已登记的回调，但默认仅为 provisional，不代表真实物理驱动已获验证。原生对象不加入 `WorldRuntime.store`，从而避免被 AgentScape 的资产删除/释放逻辑误回收。

## React 生命周期

在 React 中由组件 `useEffect` 创建宿主，组件卸载时调用 `dispose()`。示例公共宿主实现把 `attach()` 初始化作为异步操作：如果 StrictMode 清理先于 attach 完成，会在初始化返回后撤除会话；不会在半初始化状态下释放运行时，也不会丢失外部资源的所属权。

```jsx
const mount = useRef(null);
useEffect(() => {
  const host = createNativeWorldHost(mount.current, setStatus);
  void host.start();
  return () => host.dispose();
}, []);
return <div ref={mount} />;
```

不要在每次 React 重新渲染时重新创建 Three.js 世界。组件销毁后，原生 Renderer 和几何资源由 React 宿主的清理函数负责销毁。

## Vue 3 生命周期

```js
const mount = ref(null);
let host;
onMounted(() => {
  host = createNativeWorldHost(mount.value, status => { state.value = status; });
  void host.start();
});
onBeforeUnmount(() => host?.dispose());
```

普通 `script setup` 或 `createApp()` 都可使用以上生命周期。无需更改 AgentScape Runtime 的任何 Vue 专属代码。

## React Three Fiber（R3F）

R3F 已经拥有相机、渲染器和帧循环；从 `useThree()` 获取 `scene`、`camera`、`gl`，通过 `AgentScape.attach({scene,camera,renderer:gl,autoStart:false})` 绑定。存储返回的会话引用，在 `useFrame((state) => session?.scene.frame(state.clock.elapsedTime * 1000))` 调用每帧推进，并在 React Effect 清理时安全地异步关闭会话。

**不要**用发现插件去劫持 R3F 或其他 React 库内部的 Renderer 导入，默认显式接入。避免让 AgentScape 自行 render，也不要在有 R3F 循环时开启 `autoStart: true`。R3F 内部在 `node_modules` 的导入并不属于 Vite shim 默认指定的源码目录，因此不能将“自动发现”视为 R3F 的通用方案。R3F 示例尚未作为本轮浏览器验收项。

## 模块和资源边界

- 外部对象保持原有父子结构、几何与材质；AgentScape 拥有且卸载时释放的只有自己注入的 Runtime 子树。
- `NativeObjectRegistry` 只维护对象引用及可选交互回调。注册对象必须属于当前宿主 Scene，不能注册 AgentScape 自身管理的对象；同一 Object3D 不可重复登记。
- 被宿主移除的对象会在下一次 AgentScape 帧或原生对象查询时清理登记关系，但不会释放资源。
- `activate` 回调执行的是宿主代码，适用于可信项目；这不是在页面中隔离执行不可信代码的沙箱。
- `autoStart:true` 由 AgentScape 自己推进仿真；`autoStart:false` 则必须由宿主每帧推进。两种方式不可同时驱动。
- 确保 Three.js 模块实例一致，避免两个不同版本的 `THREE.Object3D` 构造器导致接入失败。

验证入口：

```sh
npx vitest run tests/integration/native-object-registry.test.js
npx playwright test tests/browser/native-frameworks.spec.js
```
