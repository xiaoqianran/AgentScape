# Debug Overlay（几何调试叠加层）

> **本文描述 1.35 新增的 Runtime 可视化能力。**
> 自动化测试与真实浏览器渲染均已验证；Debug 层保持单向只读依赖，不改写 Runtime 更新循环。

AgentScape 的 Runtime 长期拥有大量内部真值——collider、joint、NavMesh、空间关系、交互距离——但除了一个选中框 `BoxHelper` 之外，**这些真值在界面上完全不可见**。

本层把这些真值画成 3D 线框，让"Runtime 为什么这么判断"变成可看见的事实，而不是只能相信的结论。

## 1. 为什么需要它

核心卖点是**确定性验证优先于模型判断**。但如果验证过程不可见，用户就只能选择信或不信。

```text
之前：
  Agent 说"门打不开" → 用户看到失败 → 不知道为什么

之后：
  Agent 说"门打不开" → 打开 collider 图层 → 看见 blocker 碰撞体
                    → 打开 navmesh 图层 → 看见路径确实被切断
                    → 打开 relations → 看见 ON 关系未成立
```

这直接服务于仓库的核心原则：**Proposal 不等于 Success**。让用户看见 evidence，而不是结论。

## 2. 分层原则

```text
WorldRuntime（State Owner，不知道本层存在）
        ▲
        │ 只读消费：公开 API + Manifest 数据
        │
   studio/debug/（单向依赖，不写入，不入 World Core）
```

三条硬约束：

1. **不 import World Core 私有实现** —— 只消费 `store` / `manifest` / 公开只读 API。
2. **不写入世界状态** —— 本层是纯消费者，所有图层都是可重建的派生几何。
3. **不放在 `world/runtime/systems/`** —— 那里属于 World Core，被 `validate-domain-boundaries.mjs` 机械门禁约束。

第 3 条是刻意的：它逼出一个干净边界，而不是把调试代码塞进 physics/interaction 内部。

## 3. 六个图层

| 图层 | 画什么 | 数据来源 | capability 依赖 |
|---|---|---|---|
| `collider` | 根 + Part collider 线框（box/cylinder/capsule/convexHull） | `manifest.physics.colliders` | `collision` |
| `joint` | revolute/prismatic 转轴与枢轴点 | `manifest.parts[].joint` | `articulated-body` |
| `bounds` | 世界空间 AABB | `THREE.Box3.setFromObject` | — |
| `relations` | ON / NEAR 等语义关系连线 | `sceneGraph.list()` | — |
| `interaction` | Hold anchor、carry 连线、1.5m 交互距离圈 | `interactions.holdAnchor/carryStatus` | — |
| `navmesh` | Recast NavMesh 顶点云 | `navigation.navMesh` | — |

颜色区分：`collider` 根=绿 / Part=蓝 / 环境=灰，`joint`=琥珀，`relations` ON=粉 / NEAR=灰白，`interaction`=红 / carry=青，`navmesh`=青绿。

## 4. 能力缺失即禁用

这是本层最重要的设计点，直接继承 ADR-0006 的降级哲学：

```text
物理 backend 缺 collision       → collider 图层禁用并标注原因
物理 backend 缺 articulated-body → joint 图层禁用并标注原因
hasCapability 方法本身不存在     → 按不可用处理（宁可禁用，不画无真值几何）
```

反例（禁止）：

```text
没有 collision 能力，仍画出"看起来像碰撞体"的线框
图层被禁用但没有给出原因
```

用户必须能区分"这里没有碰撞体"和"这个 backend 不知道碰撞体长什么样"。

## 5. 用法

界面：视口工具栏 → **调试图层** → 勾选需要的图层。

代码中：

```js
import { DebugOverlay } from './studio/debug/DebugOverlay.js';

const overlay = new DebugOverlay(runtime);
overlay.attach();              // 必须在 runtime.init() 之后
overlay.toggle('collider', true);
// 每帧
overlay.update();
overlay.dispose();             // 卸载并释放几何
```

页面绑定（已接入 `studio/main.js`）：

```js
import { bindDebugLayers } from './studio/debug/bindDebugLayers.js';
const debugLayers = bindDebugLayers(world, { log });
```

## 6. 性能

- 未启用任何图层时不启动 Debug RAF，持续刷新开销为零。
- `collider` / `joint` / `interaction` / `relations` 依赖实时世界变换，由 Debug 层自己的 `requestAnimationFrame` 循环逐帧重建；不会 monkey patch `WorldRuntime.update()`。
- `bounds` / `navmesh` 是快照，不逐帧重建。

逐帧重建采用"销毁并重建几何"，在对象量少时足够；若未来场景规模增大，应改为复用 `BufferGeometry` 并只更新顶点。这是已知优化点，不是缺陷。

## 7. 验证状态

```text
图层几何生成 + 实例溯源            VERIFIED (tests/debug-overlay.test.js)
capability 缺失 → 图层禁用         VERIFIED
dispose 释放与场景解绑             VERIFIED
菜单生成 + 可用性联动              VERIFIED (tests/debug-layer-binding.test.js)
──────────────────────────────────────────────────────
浏览器内真实像素渲染               VERIFIED（1440×900 / 390×844）
多 world 切换后的图层一致性        NOT VERIFIED
大规模场景（Grand Urban Block）性能 NOT VERIFIED
```

浏览器内验证使用临时 Playwright + 无头 Chromium 完成；Playwright 不进入仓库运行时依赖。

## 8. 后续方向

按价值排序：

```text
1. Compiler 报告可视化   compile() 返回 16 个产物，UI 目前只展示约 7 个字段
2. Runtime 状态面板      physics.profile / navigation.status / admission 实时显示
3. Agent 决策轨迹回放    tool.called + trace 时间轴
4. 反事实假想几何可视化   1.28–1.31 的 hypothetical shape-pair（当前最不可见的精彩能力）
```

第 4 项最能体现差异化：那些 hypothetical 计算现在完全不可见，而它们正是 AgentScape 区别于普通 3D 引擎的地方。
