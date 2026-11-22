# 代码世界与可视化编辑层：第一阶段

> 目标：保留任意受信任 Three.js 的 `createProject(THREE)`、对象与渲染循环；
> Studio 和 MCP 不解析、不重写源码，通过一条 Scene API 对同一世界追加对象或修改显式开放的属性。

## 对象所有权

| 对象类别 | 创建者 | 运行时对象 | 编辑范围 | 持久化 |
| --- | --- | --- | --- | --- |
| 代码对象 | Three.js `createProject` | 原始 Object3D | 只允许 `registerEditable` 声明的属性 | `CodeProject.edits`，按稳定 ID 恢复 |
| 编辑层对象 | Studio GUI 或 MCP | `NativeSceneHost` 的 Managed Runtime | `SceneFacade` 支持的添加、变换、删除 | `CodeProject.runtime` |
| 非注册代码对象 | Three.js 源码 | 原始 Object3D | 可渲染；不暴露可视化写入 | 由原代码及 `serialize/restore` 负责 |

当前可登记位置 `position`、四元数旋转 `quaternion`、三轴 `scale`、`visible`。代码对象 ID 在**一个世界内稳定且唯一**，不构建跨世界全局 Object3D 注册表。

## 使用方式

在 `createProject({THREE})` 创建和挂载 Object3D，随后：

```js
setup({scene}) {
  scene.registerEntity({id:'tower',label:'钟塔',object:tower,read:()=>({})});
  scene.registerEditable({
    id:'tower',object:tower,
    properties:['position','visible']
  });
}
```

GUI 的「可视化」面板和 MCP 都调用同一个 `SceneFacade` / `SceneEditService`。例如：

```js
await scene.apply({
  expectedRevision:scene.observe().revision,
  operations:[{type:'editNative',id:'tower',changes:{position:[2,0,0]}}]
});
```

UI 不直接修改上述代码对象；MCP 的 `scene_apply` 使用同一个 `operations` 格式。普通添加物体依然使用 `scene.addModel`（内部调用 SceneEditService），并置于代码场景的受管理子树。

## 保存与重新运行

`StudioCodeProjects.run()` 在切换到新源码实例前捕获上一个运行时的 `runtime`、`state` 与 `edits`；`openCodeProject()` 在代码 `setup()` 注册对象且 `restore()` 执行后，按 ID 应用编辑覆盖。如果异步资源稍后调用 `registerEditable` 注册对象，系统会自动尝试应用之前尚未匹配的编辑记录。没有匹配到的 ID 保留在 `nativeEditables.unresolved`，不静默删除；源码撤销对属性的开放时拒绝恢复，并保留旧运行实例。

`CodeProject.edits` 是一个可选的版本 1 文档：`{schema:'agentscape.native-edits',schemaVersion:1,overrides:{tower:{position:[2,0,0]}}}`。代码原始 Mesh/Shader/闭包和项目运行逻辑不在其中。

MCP `worldSessionId` 是临时会话 ID；世界身份使用 `code-project:<projectId>`，在 Studio 切换世界时通过授权的 `world-change` 更新，**不会断开正在执行的 MCP 请求**。

## 限制与下一阶段

- **尚无**完整统一的 GUI/MCP 编辑历史、Undo/Redo；Native 属性修改是带版本校验的单一入口，但不是 WorldRuntime 现有历史栈的一部分。
- 显式开放的属性不应同时在用户 `update()` 动画中不停重写；如需连续动画与编辑叠加，应再引入明确的相对偏移或属性控制权协议。
- 三轴非均匀缩放已支持代码对象；受管理场景资源仍使用 WorldRuntime 原有的等比缩放。
- 当前 Studio 提供对象列表、3D 鼠标选取、变换数值表单、Transform Gizmo 拖拽、新增方块与对象删除，并显式提供「保存世界」按钮。对 Scene 的即时修改不是自动持久化。
- Gizmo 使用当前代码项目提供的 Camera/Renderer/Scene，直接复用 Three.js 官方 `TransformControls`。拖动时**只改代理 pivot 和轮廓框**；鼠标松开才通过带 `expectedRevision` 的 `scene.apply` 提交一次编辑，不直接操纵代码所有的 Object3D。若 MCP 同时修改世界、代码更新目标或父级发生移动，则拒绝本次拖拽并保留真实状态。
- 三种操作：W 移动、E 旋转、R 缩放（也可以使用面板按钮）；Esc 取消拖拽。仅允许 `registerEditable` 声明的属性；编辑层物体仍遵循现有 WorldRuntime 的**等比缩放**约束，不接受非等比缩放。快捷键历史暂由现有主世界管理，代码世界使用独立「撤销/重做」按钮，以避免误触主世界快捷键。
- 跨浏览器世界同步与统一世界目录属于后续阶段；`CodeProject` 仍保存在当前浏览器 IndexedDB。
- `registerEditable` 仅应由可信源码注册；任意项目代码仍具有正常 JavaScript 权限，不能把此能力理解为安全沙箱。

## 关键回归

- `tests/integration/native-editable-code-world.test.js`：原对象修改、版本冲突、权限、覆盖保存、源码重运行、独立世界隔离
- `tests/browser/studio-code-world-visual.spec.js`：正式构建浏览器里保存、重运行和重新打开
- `tests/mcp/studio-request-window.test.js` / `tests/mcp/studio-auto-connect.test.js`：会话世界身份同步期间保持 RPC 能力

- Studio 切换「源码 / 可视化」时始终保留源码编辑器实例，避免尚未保存的代码文本在切换面板时丢失；可视化「保存世界」保存的是**当前运行的源码版本及运行状态**，不会代替「保存源码草稿」。
- 已经打开过旧版已发布城堡的浏览器可能持有自己的旧版 IndexedDB 快照；为保护私人修改，打开已发布入口会优先采用本机版本，不会静默覆盖。可以用新浏览器上下文验证最新版或在 Studio 中手动导入新版项目 JSON。

## 第二阶段：统一 Undo/Redo 与跨浏览器 WorldRepository

GUI 「撤销/重做」与 MCP 的 `scene_history` 共享当前 `WorldRuntime.history`；Native 编辑属性使用 `recordExternal` 与已有 managed 对象快照历史交错记录。为保持物体生命周期安全，重启或重新运行世界后不会复用旧 Object3D 的历史命令。

可选跨浏览器版本发布使用 `WorldRepository`（同源服务端 API，基于现有哈希块存储）；代码世界和可视化创作草稿保持各自的文档格式，通过带版本的元数据目录发现、发布和恢复。详见 [共享世界版本存储](./shared-world-repository.md)。
