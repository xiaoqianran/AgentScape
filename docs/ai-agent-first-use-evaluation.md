# V2-PR-09 — AI 代理独立实操评测

- 日期：2026-11-05
- 执行者：ChatGPT（AI 代理），经 PC2 AgentDock MCP 执行本地进程及 Chromium 真实交互
- 代码基线：`6a03bd2`（`feat/scene-api-v1`）
- 环境：Windows / Node 24 / Chromium SwiftShader；浏览器使用本地 production preview
- **证据分类：独立 AI 代理实操评测；不是独立自然人的首次使用验收。**
- 正式真人记录：`docs/first-use-check.md`，继续保留 `not performed`。

## 直接操作证据

### 首次使用 /starter/

Agent 从浏览器访问入口、等待真正 Runtime ready、完成拿取和放置、先错误地移动未添加的椅子再恢复操作、添加和移动椅子、点击下载、刷新页面、使用可见的“Open saved world”入口上传导出文件、重新拾取和放下、上传格式错误 JSON、检查渲染画布并模拟拖动/滚轮视角，最后调整到 390 × 844 窄屏。

- **11/11 操作步骤通过**，浏览器未出现未捕获的页面异常
- 首次页面 ready：610ms（本机已安装依赖、预构建，不是新用户冷安装耗时）
- 首次拿取：3551ms；首次放置：5539ms
- 添加和移动椅子：937ms；下载：1396ms；刷新及恢复：6638ms
- 恢复后再次拿取并放置：2234ms
- 输入无效 JSON 后返回错误，原有 4 个对象仍保持
- 合计操作时间：24029ms；**不包含 npm ci、开发者查阅文档或首次配置，不得据此宣称达成新用户五分钟目标。**
- 原始机器证据：本机忽略目录 `.tmp-release/agent-first-use.json`；本次 Playwright 报告附件和移动端截图位于 `test-results/browser/`。实操脚本保留在 `dev/evaluations/agent-independent-evaluation.spec.js`，不纳入默认 CI 浏览器套件，避免把一次性调查当作长期发布门槛。

### 外部 MCP Agent

直接使用官方 `@modelcontextprotocol/client` 创建独立 HTTP MCP 客户端及临时身份，在隔离的本地服务中：

1. `session_create`、`scene_observe`：读取 4 个真实物理对象和杯子处于柜内的空间关系。
2. `action_execute`：`approachAndInteract` 打开柜门、`approachAndPickup` 拿取杯子、`approachAndPlace` 放置到桌面，三次真实动作全部 `state=verified`；`world_verify` 返回 `world-accepted`。
3. `scene_set_style` 切换 Toon，并确认对象 ID 不变；`scene_save` 返回包含 project、snapshot、assets、style、lock 的完整包。
4. 请求不存在的 StylePack 得到 `STYLE_UNAVAILABLE`，世界 4 个对象保留；最后 `session_close` 释放会话。

- **7/7 步骤通过**，各接口通过真实 HTTP MCP Transport 调用，非模拟工具返回。
- 原始机器证据：本机忽略目录 `.tmp-release/agent-mcp-evaluation.json`。
- 重要语义：Headless MCP 返回风格状态为 `deferred`、`rendered=false`、`applied=null`；这是保存配置而非渲染器实际应用的证明，不能将其表述为“远端画面已切换”。
- 此次不覆盖无 Docker 环境中的实际容器隔离，也不证明外部商业模型质量。

## 实际发现的问题

**P1 — Starter 移动端横向溢出（真实复现）**

在浏览器从桌面宽度调整到 390px 时，`document.documentElement.scrollWidth=1090px`，而 `innerWidth=390px`；`#viewport` 自身宽度已是 390px，但此前的 canvas 仍是 1090px 宽。说明 UI 容器响应式已切换，但 3D canvas 未随 resize 完整适配，移动端会出现严重横向滚动/可能裁切。重现：在 Starter 首次加载后把浏览器窗口缩至 390px；滚动检查横向溢出。需修复 renderer/canvas 的 resize 处理并补充 resize 回归测试。**本轮未更改 renderer，避免单纯通过 `overflow:hidden` 掩盖裁切问题。**

**P2 — Headless 风格效果的认知差异（语义警告）**

MCP `scene_set_style` 返回 `deferred` 而非渲染成功；现有数据结构准确表达了差异，但面向 Agent 的 SDK / 文档应显著指出“配置保存成功 ≠ 视觉渲染验收成功”。这不是本次失败，不宜误报为功能故障。

**P2 — Starter 与 Studio 能力边界需更显著**

Starter 的说明只在展开的 `Make it yours` 中指出四个内置资源及尚不支持 StylePack / 通用项目包。首次使用者可能将 Starter 能力误判为完整产品能力。建议入口增加明显的“前往 Studio”及“开始使用 SDK / MCP”指引。

## 验收结论

- 本轮 AI 代理对**实际 UI 和外部 MCP**的可操作性评测通过；发现 1 项 P1 移动端问题、2 项 P2 产品体验/文档问题。
- 目前**无法替代** `docs/first-use-check.md` 所定义的非开发者真人、干净环境下独立测量；不得填写真人角色、虚构安装耗时或将此报告标记为人类验收通过。
- GitHub Actions 已在 `6a03bd2` 上成功结束 4/4 Jobs，并上传两份产物：<https://github.com/xiaoqianran/AgentScape/actions/runs/41952931923>。
- 建议正式 V2-PR-09 状态保持 `IN_PROGRESS`，直到产品体验问题按发布支持范围处理、真人验收完成及对应候选版本 CI 核验。
