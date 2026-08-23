# Curated Worlds

AgentScape 从 1.11 开始把“世界内容”作为独立内容层，而不是把美术结构继续写进 Runtime。

当前 Pages 有两个 curated world：

```text
WORLD 01 · Monument Hall
WORLD 02 · Ruined Courtyard
```

它们共享完全相同的：

```text
WorldRuntime
PhysicsSystem
NavigationSystem
SkillRegistry
SceneSerializer
Editor
Agent Tools
```

不同的只是 environment factory。

## Environment Catalog

世界注册在：

```text
src/content/environments.js
```

每个条目只描述：

```text
id
number
title
headline
description
facts
create()
bootstrap positions
```

Runtime 不再写：

```text
if world === monument ...
if world === ruins ...
```

Pages 通过：

```text
?world=ruined-courtyard
```

选择内容条目，然后：

```text
new WorldRuntime(viewport, {
  environmentFactory: definition.create
})
```

所以未来新增第三世界，只需要增加 content pack + catalog entry；不需要新增 SceneManager。

## 为什么 World 切换使用 reload

当前 World selector 不做热切换：

```text
select world
   ↓
更新 ?world=
   ↓
reload page
```

这是有意设计。

一次页面生命周期始终只有：

```text
1 Three.js Scene
1 Rapier World
1 NavigationSystem
1 Recast/TileCache state
1 Autosave namespace
```

如果现在为了“无刷新切换”引入 SceneManager，就必须额外解决：

- pending texture load cancellation。
- Rapier environment body teardown。
- Recast static geometry rebuild。
- Editor selection teardown。
- Autosave controller ownership。
- History 环境边界。

对于两个展示世界，reload 更简单、更可靠，也天然支持可分享 URL。

## Environment Pack Contract

当前两个 pack 都返回：

```text
id
root
floor
colliders
camera
rendering
dispose()
```

其中：

```text
root
→ Three.js visual truth
→ Recast static geometry

colliders
→ Rapier fixed geometry

camera
→ curated initial view

rendering
→ background / fog / exposure
```

因此一个残墙不能只存在于画面里。

如果它会阻碍 Human / Agent：

```text
visual mesh
+
physics collider
+
navigation geometry
```

必须共同存在。

## WORLD 01 · Monument Hall

约：

```text
32 × 24 m
```

空间语言：

```text
对称
高柱列
中央纪念台
后殿
冷暖人工灯光
```

用途：

- 第一主视觉。
- 展示大尺度室内空间。
- 展示 Agent-ready object / cabinet / cup interaction。
- 展示中央障碍导航绕行。

## WORLD 02 · Ruined Courtyard

约：

```text
36 × 30 m
```

空间语言：

```text
open sky
broken arcades
split-level terraces
fallen columns
central dry fountain
moss / grass / reclaimed stone
```

它不是 Monument Hall 换材质，而是专门增加第二组空间压力：

```text
高低差
多个入口
台阶
开放边界
斜置 / 倒塌 collider
自然装饰 instancing
```

### Split-level Navigation

东高台：

```text
y = 1.2m
6 steps × 0.2m
```

西残廊：

```text
y = 0.8m
4 steps × 0.2m
```

真实 Recast 回归要求：

```text
south courtyard
    ↓
step sequence
    ↓
east terrace
reachable = true
max path y > .9
```

以及：

```text
south courtyard
    ↓
west steps
    ↓
west terrace
reachable = true
max path y > .6
```

这证明高台不是纯视觉 elevation。

### 中央枯泉

主轴中央的 Dry Fountain 同时是：

```text
Three cylinder
Rapier fixed cylinder
Recast obstacle
```

测试从南端到北端，Detour 必须产生横向绕行。

### 旋转 Environment Collider

1.12 给 `PhysicsSystem.addColliders()` 增加可选：

```text
rotation: [x,y,z,w]
```

用于：

- fallen columns。
- collapsed beams。
- rotated arch supports。

它直接映射 Rapier `ColliderDesc.setRotation()`，没有引入第二种 transform representation。

## 植被为什么使用 InstancedMesh

Ruined Courtyard 当前有 12 个 grass patches，每组 9 株，总计：

```text
108 grass instances
```

但 Three.js 中只有：

```text
1 geometry
1 material
1 InstancedMesh
```

Navigation 明确忽略这些装饰性实例。

当前不需要 LOD，因为没有大型高面数 hero vegetation；先避免 draw-call 膨胀更重要。

## World-specific Autosave

1.11 以前只有：

```text
agentscape.scene.autosave
```

多世界后改为：

```text
agentscape.scene.autosave.monument-hall
agentscape.scene.autosave.ruined-courtyard
```

旧的 Monument Hall autosave 会在新 key 不存在时兼容复制一次；不会删除旧数据。

因此：

```text
World 01 object layout
≠
World 02 object layout
```

不会互相覆盖。

## Scene Environment Identity

Scene JSON 现在增加可选：

```json
{
  "metadata": {
    "environment": "ruined-courtyard"
  }
}
```

Restore 规则：

```text
scene.environment missing
→ 兼容旧 scene

scene.environment == runtime.environment
→ restore

scene.environment != runtime.environment
→ reject before clearObjects()
```

这是为了避免：

```text
Ruined Courtyard export
        ↓
Monument Hall import
        ↓
对象恢复成功
但所有空间语义已经换世界
```

## 为什么暂时不做 Environment Streaming

当前最大世界只有 36 × 30m，且静态几何很轻。

Recast 当前已经使用 TileCache 路线；真正进入城市级世界后，需要测量的是：

```text
静态 geometry input size
Recast build time
纹理 GPU memory
draw calls
visibility / spatial partition
```

而不是因为“有第二世界”就提前实现 streaming。

第三世界 `Grand Urban Block` 会成为是否需要 region/streaming 的第一个真实压力测试。

## 为什么当前不引入 KTX2 / LOD 系统

第二世界开始关注规模，但优化仍按事实触发。当前两个 world 都只使用 1K 外部纹理，Ruined Courtyard 的自然重复物已经用 `InstancedMesh` 控制 draw calls。

Three.js / glTF 社区的成熟经验是：KTX2/Basis 的主要收益来自 GPU texture memory 与 upload；当纹理分辨率高、数量多时很有价值，但 1K 少量纹理阶段没有必要先引入 transcoder/runtime plumbing。

因此当前顺序是：

```text
1K web assets
→ measure GPU/upload
→ Grand Urban Block real pressure
→ only then KTX2 / LOD / streaming if justified
```

不因为“未来可能有大世界”先增加一套压缩/LOD 管线。
