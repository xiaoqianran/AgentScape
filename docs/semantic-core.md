# AgentScape Core：纯 Three.js 语义扩展

AgentScape Core 不是世界引擎、编辑器、Agent 编排器或代码审批平台。核心仅为用户已有的 THREE.Scene / THREE.Object3D 提供可选的语义、状态和动作注册能力，不接管原生 Three.js 渲染循环或资源生命周期。

## 安装与使用

~~~
npm install agentscape3d three
~~~

~~~js
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { attach } from 'agentscape3d/core';

const scene = new THREE.Scene();
const world = attach(scene); // 同步，无审批、无 MCP、无模型密钥、无沙箱依赖

const gltf = await new GLTFLoader().loadAsync('/cabinet.glb');
scene.add(gltf.scene);

const door = gltf.scene.getObjectByName('Door_L');
if (!door) throw new Error('GLB does not contain Door_L');
const unregister = world.register(door, {
  id: 'cabinet-door',
  type: 'door',              // 开放字符串，不受内置类别限制
  description: '柜子的左门',
  properties: { material: 'wood' },
  read: () => ({ angle: door.rotation.y }),
  actions: {
    open: () => { door.rotation.y = -Math.PI / 2; },
    close: () => { door.rotation.y = 0; }
  }
});

console.log(world.list());
await world.invoke('cabinet-door', 'open');
console.log(world.inspect('cabinet-door').state);
unregister();
world.dispose(); // 不删除 GLB、不销毁 Geometry/Material/Renderer
~~~

也支持 AI 直接用 Three.js 构建的任何 Mesh、Group、Object3D，不要求先转换成 Asset Recipe 或 GLB，不设置固定物体类别、动作名称或数量上限。

## 插件仅按需安装

核心不加载 Studio、Pi、DSH、MCP、沙箱、物理引擎或权限策略。插件只是显式调用的扩展函数，可监听实体与动作生命周期；核心既不要求安装插件，也不替插件规定能力策略。

~~~js
const unsubscribePlugin = world.use((runtime, options) => {
  const unsubscribe = runtime.subscribe(event => {
    if (event.type === 'entity.registered') console.log('New entity', event.id);
  });
  return () => unsubscribe();
});
unsubscribePlugin(); // 卸载插件，但不影响世界中已经注册的实体和动作
~~~

核心提供 register、unregister、registerAction、getObject、inspect、list、invoke、subscribe、use、dispose。动作执行由用户提供的 JavaScript 函数直接完成，无内置 TaskCompiler、验收规则、审批或代码沙箱。由此也意味着，**不可信代码的执行风险属于调用它的宿主环境**；需要隔离或权限控制时，开发者可在外层接入相应插件/部署策略。

## 兼容与演进边界

- 新的轻量入口为 **agentscape3d/core**；打包后仅包含通用语义注册核心，不依赖 WebGL、DOM 或大型运行时。
- **当前仅完成运行模块解耦**：原有 agentscape3d npm 包仍打包整套旧引擎/网站并声明它们的依赖，安装体积尚未按插件拆分；不应将 6.9 KB 的核心入口误解为整个 npm 包只有这些内容。
- 现有 **AgentScape.attach({scene,camera,renderer})** 是旧的完整 NativeScene/WorldRuntime 接入路径，暂时保留，以免影响现有应用。
- 根入口 **agentscape3d** 与 **agentscape3d/core** 现在都只导出轻量语义核心；完整 Runtime 已迁移到可选的 **agentscape3d-engine**。
- 已有 MCP、Studio、资产编译及验证功能可以继续单独使用，但都不是 Core 的强制依赖。其独立插件化和入口精简需要后续逐步完成，不能视为本次已经全部迁移。

## GLB 语义的界限

现阶段在 GLTFLoader 加载完成后，对相应 Object3D 节点显式注册语义。Core 不猜测某个 Mesh 一定是门，也不声称视觉动画拥有真实物理交互能力。

将来可增加独立的 glTF extras/扩展或 sidecar JSON 导入插件，把持久化语义重新绑定到 GLB 节点。它必须容忍未知语义属性，不能把少数 Runtime 验证关系当作全部世界知识。
