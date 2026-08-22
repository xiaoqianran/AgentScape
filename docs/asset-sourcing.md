# AgentScape 素材来源与美术准入

AgentScape 的素材策略不是“越多越好”，而是：**许可清晰、风格统一、Web 成本可控、进入 Runtime 后仍保持空间真值。**

## 当前主场景：Monument Hall

1.11 的 `Monument Hall` 是第一个 curated environment pack。它采用：

```text
程序化建筑体块
+
CC0 HDRI
+
CC0 PBR 材质
+
AgentScape 自己的 Physics / Navigation truth
```

而不是直接下载一个巨大场景 GLB。

这样可以同时控制：

- 构图与风格。
- 首屏资源大小。
- Rapier collider ownership。
- Recast 静态几何。
- 后续可扩展性。

## 已使用素材

### Poly Haven — Solitude Interior

- 类型：HDRI
- 页面：https://polyhaven.com/a/solitude_interior
- 本项目文件：`public/assets/monument-hall/solitude_interior_1k.hdr`
- 分辨率：1K
- 文件大小：约 1.63 MB
- 许可证：CC0
- 用途：只作为环境光 / 反射环境，不作为建筑视觉背景。

为什么只取 1K：网页实时环境光并不需要 8K/20K HDRI；更高分辨率会把几十到几百 MB 资源放进 Pages，却几乎不改善当前镜头的照明质量。

### Poly Haven — Marble 01

- 类型：PBR Marble Texture
- 页面：https://polyhaven.com/a/marble_01
- 许可证：CC0
- 本项目文件：
  - `marble_diff_1k.jpg` — 约 305 KB
  - `marble_nor_gl_1k.jpg` — 约 110 KB
  - `marble_rough_1k.jpg` — 约 92 KB
- 用途：Monument Hall 主地面。

选择 GL normal map，不使用 DirectX normal map，因为 Three.js 使用 OpenGL tangent-space convention。

## 本轮审计但没有进入 Monument Hall 的平台

### Kenney

- 网站：https://kenney.nl/assets
- 资产页通常使用 CC0。
- 优点：轻量、模块化、非常适合道路、城市 kit、UI。
- 本轮未使用原因：低多边形 / game-kit 气质与 Monument Hall 的写实博物馆风不一致。
- 后续候选：`Grand Urban Block`。

### Quaternius

- 网站：https://quaternius.com/
- 大量 pack 使用 CC0。
- 优点：建筑、自然、城市、角色模块丰富，适合快速扩张场景规模。
- 本轮未使用原因：风格更偏 stylized low-poly，不与 Monument Hall 混用。
- 后续候选：独立低多边形世界，而不是混入写实主场景。

### ambientCG

- 网站：https://ambientcg.com/
- CC0 PBR / HDRI / Models。
- 本轮未额外加入原因：Poly Haven Marble 已满足主地面需求，继续增加类似 PBR 只会增加网络与仓库成本。
- 后续候选：Ruined Courtyard 的石材、苔藓、地面系统。

### Sketchfab

- 网站：https://sketchfab.com/
- 许可按单个模型不同，不能把“平台可下载”理解成统一 CC0。
- 只考虑 license 明确的 Hero Asset；逐个记录作者、license、source URL。
- 不做批量抓取。

## 素材准入规则

一个外部素材进入仓库前至少满足：

```text
[ ] License 明确
[ ] source URL 可追溯
[ ] 与目标世界风格一致
[ ] Web 版本资源大小合理
[ ] 不复制已有素材能力
[ ] 需要 collision 时有真实 collider plan
[ ] 需要 navigation 时不会只是视觉障碍
[ ] 需要 articulation 时走 Asset Compiler，而不是手工写 action 标签
```

## Environment Pack 与普通 Asset 的区别

普通 Asset：

```text
GLB / Manifest
→ AssetManager
→ ObjectStore
→ editable world object
```

Environment Pack：

```text
curated architecture
├─ Three.js visual geometry
├─ Rapier fixed collider descriptors
├─ Recast environment root
├─ lighting / HDRI / material references
└─ camera preset
```

Environment Pack 不进入普通 ObjectStore，也不污染 Undo/Redo；它是 World 的固定舞台。

但是它的墙、柱、纪念台仍必须同时进入 Physics / Navigation。**视觉布景不能成为 Agent 可以穿透的假世界。**

## 资源预算

1.11 Monument Hall 新增 public assets 总计约 2.1 MB。

```text
HDRI     ~1.63 MB
Marble   ~0.51 MB
----------------
Total    ~2.14 MB
```

没有使用 8K/16K/20K 原始资产。

未来每个 curated scene pack 都应单独记录：

- Raw source size。
- Web-export size。
- 首屏是否加载。
- 是否 lazy load。
- GPU texture cost。

美术质量不能绕过已有 Resource Budget 原则。
