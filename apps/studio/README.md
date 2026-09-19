# Studio

人类编辑器与产品 UI，入口 main.js，公开路径 /。
使用 application/createSession.js 装配产品模块；输入、帧循环、面板和自动保存触发仍由本应用管理。
保留现有 editor/ui/react/build 结构和工作台功能，不增加企业式横向层。

任务见 tasks.jsonl。验证：npm run test:studio、npm run typecheck、npm run build。

## Studio UI 边界

Studio 采用单 React Root 的产品展示层，避免视觉设计反向侵入 World / Agent / Asset / Generation 主链路：

- `main.js` 只负责产品装配与用例编排，不创建产品 DOM。
- `ui/AppShell.js` 只创建一次 `createRoot(app)`，并保留一个窄 UI facade 给 bootstrap / runtime adapters 使用。
- `react/StudioApp.tsx` 是 Shell、Chrome、Dock、Workspace、Command Bar 与产品面板的唯一 DOM owner。
- `ui/chrome/StudioChrome.js` 只保留导航模型与 URL 纯函数，不再持有 DOM 生命周期。
- `TaskPanel`、`RunsPanel`、scene controls 与 authoring controls 是独立 controller/store；React 通过 external-store contract 消费它们，不让业务执行逻辑进入 hooks。
- `StudioWorldSurface`、`HumanViewController`、`WorldInteraction`、`RuntimeDriver` 继续保持 imperative，它们属于 Browser ↔ Runtime adapter，不属于产品 Presentation。
- Advanced Generation、Developer Settings、Debug Overlay 仍可作为明确的 technical island 使用 imperative DOM，但不能成为普通产品 UI 的依赖方向。

核心所有权固定为：React owns DOM；WorldRuntime owns World；Three renderer owns GPU scene；controllers connect them。

### CSS ownership

旧的 `apps/studio/style.css` 已退休。样式与产品 owner 同目录维护，不再用后加载的全局 stylesheet 覆盖前面的历史版本：

~~~text
ui/chrome/
  studio-tokens.css       design tokens
  studio-base.css         reset / accessibility / transitional feature tokens
  studio-shell.css        Studio chrome + responsive layout

react/build/BuildWorkbench.css        Build
react/artifacts/*.css                 Artifact Tray
react/inspect/ObjectInspector.css     Inspector
ui/task/TaskPanel.css                 Agent task panel
ui/generation/GenerationJobCenter.css Advanced Generation
ui/resources/ResourceLibrary.css      Library
ui/runs/RunsPanel.css                 Runs
ui/developer/DeveloperSettings.css    Developer dialog
debug/DebugLayers.css                 Debug controls
ui/WorldOverlays.css                  world-first / cabin / placement overlays
ui/content/StudioContent.css          small shared content primitives
~~~

一个 feature selector 只允许由它自己的 CSS owner 定义；Build 对 Advanced Generation 的显隐是唯一明确的跨 feature layout 例外。`architecture:validate` 会阻止全局 `style.css` 回归，以及 Build / Task / Generation / Resource / Runs / Inspector / Developer / Debug / World Overlay selector 越界。

## 前端架构

Studio 不复制 Runtime 事实，只保存产品交互需要的临时状态。当前边界：

~~~text
main.js                         composition root
   │
   ├─ bootstrap/                lifecycle / dependency wiring
   │
   ├─ AppShell                  one createRoot(app) + narrow UI facade
   │      │
   │      ▼
   │   StudioApp               React owns product DOM
   │      ├─ Chrome / Dock / SceneToolbar
   │      ├─ SceneExplorer / Inspector
   │      ├─ BuildWorkbench / ArtifactTray
   │      ├─ TaskPanel / RunsPanel / ResourceLibrary
   │      └─ studioStore        UI-only state
   │
   ├─ controllers/projections   product behavior + external stores
   │
   └─ runtime adapters          imperative
          ├─ StudioWorldSurface
          ├─ HumanViewController
          ├─ WorldInteraction
          └─ RuntimeDriver
                 │
                 ▼
             WorldRuntime
~~~

- `react/state/studioStore.ts` 只拥有选择、Workspace / Context、Recent Outputs、Build workflow intent 等 UI 状态，不保存第二份 World / Asset / Generation truth。
- `SceneExplorer`、`ObjectInspector` 读取 `WorldQueries`；写操作经 `AgentTools` / `WorldCommands`，不直接修改 Runtime systems。
- `StudioBuildController` 是 Build UI 对 Generation 的产品接口；composition root 只注入 `GenerationRuntime`、事件与状态同步回调，Controller 不持有整个 `WorldRuntime`，组件也不直接操作 Connector / Provider internals。
- `resources/StudioResources.js` 是 Library / Build preview / Artifact Tray 的产品资源投影；composition root 显式注入 `AssetModule`、`ArtifactModule`、事件与 environment getter，隐藏 Registry、ByteStore 与持久化细节，也不持有整个 `WorldRuntime`。
- `editor/`、`runtime/`、`HumanViewController` 属于浏览器 Runtime adapter，可以接触 Rendering / Physics / ObjectStore；它们不是 Presentation，因此不强行包空 facade。
- `ui/generation/GenerationJobCenter.js` 与 `ui/developer/` 是明确的 Advanced / technical surface，可以展示底层诊断信息，但不作为普通产品 UI 的依赖方向。

依赖方向保持：

~~~text
Presentation
    ↓
Studio product controllers / projections
    ↓
application + public domain boundaries
    ↓
World / Asset / Generation internals
~~~

`architecture:validate` 会阻止 React 产品 UI 与 Resource Library 重新直接读取 `world.assetModule`、`world.generation.artifacts`、`world.physics`、`world.store`、`world.rendering` 等 Runtime internals。

## 世界优先体验：林间工坊

访问 `/?world=woodland-workshop`，或从世界选择器选择「林间工坊」。默认世界仍为纪念大厅。

参考工作区 `web-012-line-art-style-magic-cabin/index.html` 的持续世界视口、点击/拖动区分和原地交互方式。新环境由 `modules/world/content/woodlandWorkshop.js` 提供，建筑 collider 与可见结构一起定义，导航使用生产 Recast；柜子、桌子、杯子和 Agent 使用现有 bootstrap 资产。

工坊默认收起面板。点击对象出现随对象位置更新的动作浮层，动作经 AgentTools 执行并显示失败原因；「检查详情」展开现有 Inspector，「让 Agent 操作」将对象 ID 带入输入框。底部工具栏按需打开 Build、Agent、资源和记录，「返回世界」收起面板。拖动视角不会触发选择。

世界内原地编辑（魔女小屋同样适用）：世界定义用 `inlineEditors` 声明表单，`apps/studio/ui/WorldInteraction.js` 构建带稳定 `#<id>Input` / `#<id>Ok` 契约的浮层，世界内容模块再绑定保存。林间工坊的告示板与木牌文字都画在真实 CanvasTexture 上，点击物件即原地编辑，并保存在当前浏览器。

视角控制：`apps/studio/ui/HumanViewController.js` 提供轨道 / 第一人称 / 第三人称三种模式，轨道仍为默认。人类体是只用于查询的胶囊 manifest，不进入 ObjectStore / Physics / Navigation：移动前用生产 Rapier 的 `checkManifestPose` 判定无碰撞，地面高度来自 `physics.raycast`，第三人称相机会被真实墙体拉近。人类视点通过 `InteractionSystem.setHumanViewPose` 成为当前交互视点。

生成落点：底部工具栏的「生成落点」可在世界里指定生成物落点。已有完成的 3D 结果时直接以真实 cursor 拖动 ghost，并按 `checkManifestPose` 判定可放 / 不可放；否则先固定一个地面 anchor。之后 Build 与资源栏的「加入当前世界」优先落在该落点，没有落点则仍落在视图中心。

图片生成仍使用现有 Build 流程与连接器配置；生成任务运行中的占位 ghost 与 Observatory 未改动。

## 原版二层魔女小屋迁移

访问 `/?world=magic-cabin`，或选择「魔女小屋 · 原版迁移」。这与上面的简化林间工坊是两个世界。

直接迁移参考 HTML 的两层房屋、旋转楼梯、室内外陈设与点击动画。点中物件即可交互；浮出的动作按钮可以重复执行。「全景 / 一楼 / 二楼」改变观察位置，「显示完整外墙 / 剖开房屋」切换原版切面。「寻找可交互物件」可定位小物件，方便发现书架书本、计划板便签等细节。路牌和便签支持原地文字编辑，挂画支持图片地址或本地图片上传；编辑内容保存在当前浏览器。

详细迁移范围、来源与验证见 `modules/world/content/magic-cabin/README.md`。本次按用户要求不运行浏览器验证，验证使用代码测试、真实 Rapier / Recast、类型检查与构建。
