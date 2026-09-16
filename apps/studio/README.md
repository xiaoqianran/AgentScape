# Studio

人类编辑器与产品 UI，入口 main.js，公开路径 /。
使用 application/createSession.js 装配产品模块；输入、帧循环、面板和自动保存触发仍由本应用管理。
保留现有 editor/ui/react/build 结构和工作台功能，不增加企业式横向层。

任务见 tasks.jsonl。验证：npm run test:studio、npm run typecheck、npm run build。

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
