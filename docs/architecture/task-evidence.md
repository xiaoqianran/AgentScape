# 任务证据体系

Agent Host 的最终返回新增 evidence（schema=agentscape.task-evidence，schemaVersion=1）。它复用既有 Scene/Runtime/SceneObserver/VisualReview 的实际结果，不创建第二套世界状态，不向 Core 引入验收策略。

| 维度 | 来源 | 验收边界 |
| --- | --- | --- |
| structure | scene_verify 的 world-valid/object-exists/relation-exists；同帧原生根节点快照 | 检查当前后置条件；原生几何统计是 observed 而非 verified，不能证明特定外观 |
| behavior | state-equals、interaction-verified | 状态快照只证明采样时的值；已验证动作必须提供 Runtime 的 interaction-evidence 凭证，并匹配目标、能力及来源 |
| visual | scene_verify(snapshot=visual) 中的真实 JPEG + 视觉模型 | 真实 JPEG 的 SHA-256、评分、问题及运行绑定；评价通过不等于物理或动作验证 |
| persistence | 已保存的项目凭证 | 新建项目需要匹配项目、运行实例、源码和 Scene 修订的持久化证据 |

每次验收由 Host 重新读取运行实例与 Scene revision，并逐项核对 verifier 返回的 ID、kind、目标、关系参数、期望状态或动作凭证。遗漏、替换、重复条件均不能通过；受限项目额外检查注册实体，不得替代用户要求。初次验收未通过时保留已观察条件和失败原因，未观察的必要条件不标记通过。

所有当前证据绑定 worldSessionId、projectId、projectRevision（源码/草稿版本）、runtimeId、sceneRevision（受管理的编辑版本）。Code Project 的最终验收调用 scene_verify(snapshot=inspect/visual)，在 Studio 的同一次同步执行中获取后置条件、根节点观察和可选 JPEG，并记录 frame/tick。Runtime 或编辑版本改变、采样中帧推进均拒绝采样；Canvas 暂未就绪则最多约 2 秒重试整组采样，不拼接不同帧的证据。视觉审阅使用该组采样的原始 JPEG，不再另行截图；图像摘要与采样帧绑定。证据 snapshot.scope=sampled-runtime-state 表示采样时状态，动画允许继续，不保证后续每一帧的状态、外部定时器或自定义渲染副作用。原生根节点统计可能包括 Studio 辅助对象。保存凭证验证持久化编辑版本，而非与后续采样帧的动态状态完全相同。

视觉评审开启时，结构与行为验收通过后内部状态为 awaiting-visual、verified=false；只有当前项目/运行/编辑绑定、同组 frame/tick 和真实截图 SHA-256 一致且评价通过才允许 completed。修订后的世界需要重新验收，旧评价留作历史；修订异常且无法重新确认世界时，旧证据失效。视觉模型评价与客观验收分别报告，不保存原始图像。未要求的证据维度标记 not-required。默认 world 模式的 coverage 为 agent-selected-postconditions，只能证明选定后置条件，不是所有用户意图；strict 模式为 user-derived-checks，编译不完整时为 unresolved-user-requirements。是否启用视觉仍由现有 auto/on/off 策略和 strict 视觉要求决定。Studio 任务状态与日志显示分类证据及验收范围。

回归：tests/agent-host/task-evidence.test.js（条件遗漏、动作凭证、未知/过期证据、截图绑定和修订失效）、tests/browser/agent-visual-loop.spec.js（真实 Studio 渲染与模型回包模拟的完整反馈闭环）。
