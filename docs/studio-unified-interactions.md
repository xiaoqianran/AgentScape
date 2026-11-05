# Studio / Scene API / MCP 统一交互（V2-PR-13）

## 目的与唯一事实来源

Studio 对象属性面板不再以 Asset Manifest 中的静态 `actions` 充当交互权限，改由同一 `createSceneFacade(world)` 实例的 `inspect(target,{actor})` 读取 `WorldAffordances`，与 SDK 的 `scene.inspect` 和 MCP 的 `scene_observe({target,actor})` 一致。能力结果按请求读取真实 ObjectStore / Physics 状态，不在 UI 或 Agent 层维护另一份实体状态。

- `execution:interaction` 是具身交互，可通过统一 `scene.interact` 与 `scene.waitJob` 获取实际完成证据。
- `execution:world-action` 是环境契约，Studio / SDK / MCP 使用同一个 `scene.interact` 入口。环境开关、书本、文字修改根据契约检查可达性、状态和后置条件；`physicsVerified=false` 不得宣称真实机械抓取或力学验证。
- `execution:editor` 是编辑器变换，与 Agent 的推动、拖动和施力分离。原有缩放/画布变换功能保留，但不冒充已验证的物理操作。
- `available:null` 是「尚未检查 Agent 可达性」，`available:false` 是当前检查未通过；两者都不应在 UI 中表示为可立即执行。真实执行还必须在调用时重新验证，不能依靠 UI 缓存判断成功。
- 对静态刚体 `push`、缺乏物理准入的外部关节、被占用或无法触达的对象，UI 展示明确的阻塞原因并禁用按钮。
- 统一操作发生失败或未验证时 `EditorCommandQueue` 不计入成功修改，不更新 Inspector 修订号；成功则刷新当前物体视图。

## Studio 使用流程

在世界编辑器选中物体 → 右侧「对象属性」→ 「可用操作」；选择动作、方向和距离（推动/拖动）、旋转弧度、关节目标、支撑面或文本后执行。界面使用当前世界中的第一个 Agent 进行具身可达性检查，显示其 ID。若当前无 Agent，动作禁用，不能借用编辑器移动的成功结果。

魔女小屋等具有正式环境能力契约的内容，可在环境物件目录选择对应物件，跳转到统一的属性交互面板；原先的快速点击编辑器交互保留编辑器语义。选中 Runtime 实体后的世界悬浮操作卡片也走 `SceneFacade.interact`，其「动作状态已验证」以 `SceneResult.verification.status` 为准，而非旧工具调用返回时直接提示「已执行」。

SDK / MCP 示例：

```ts
const inspection = scene.inspect('crate_01', {actor:'agent_01'});
const push = inspection.actions.find(item=>item.action==='push');
if (push?.available===true) {
  const job=scene.interact({actor:'agent_01',target:'crate_01',action:'push',
    args:{direction:[1,0,0],distance:0.4}});
  const completed=await scene.waitJob(job.id);
  // 只有 completed.result.verification.status === 'verified' 才能宣称完成
}
```

环境契约动作可用相同 API：

```ts
const job=scene.interact({actor:'agent_01',target:'cabin:table-lamp',action:'turn_on'});
const completed=await scene.waitJob(job.id);
```

## 验收范围与待办

- 真实 SceneFacade 推动之前未知的动态箱子：验证求解器运动和 `physicsVerified=true`，旧 Editor 工具未被调用。
- 固定椅子无法推动：返回 `TARGET_NOT_DYNAMIC`，不能标记已成功。
- 环境开关：Studio 控制队列与真实 HTTP MCP 客户端均通过 `scene.interact` 驱动契约并返回 `device-state` 证据，明确 `physicsVerified=false`。
- Chromium 浏览器检查能力下拉菜单、阻塞原因、物理参数编辑及现有 WebGL 渲染。
- 下一阶段可增加用户指定 Agent、环境对象统一画布拾取、交互中取消/恢复和多物体任务规划；当前默认使用第一个可用 Agent，环境 contract 动作不会自动寻路。
- 本任务不声称所有外部模型都可自动推断物理关节，也不代替 PR-09 规定的独立真人首用验收。
