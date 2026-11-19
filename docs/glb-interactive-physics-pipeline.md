# GLB 交互物理管线

```text
GLB → AssetCompiler → Manifest → WorldRuntime → EntityCapabilityRegistry → PhysicsSystem / InteractionSystem
```

Manifest 需要描述资产身份、部件 ID、动作、关节、刚体类型、质量、摩擦和碰撞体。动态刚体必须拥有有效质量和受支持的碰撞体。专用动作必须显式声明，节点名称不能直接充当长期身份。

Runtime 负责实例化和生命周期事务。PhysicsSystem 负责刚体和碰撞事件。InteractionSystem 负责可达性、接近、执行和验证。Three.js 继续负责视觉对象、材质、动画和渲染。

失败时按逆序清理物理、热模拟、实体索引和视觉对象。新增碰撞形状或 GLB 自动推断规则必须同时加入 manifest 校验、后端适配和回归测试。
