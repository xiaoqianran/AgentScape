# Asset Forge P0：可计算材料与热学资产

## 目标和边界

从现有机械资产创建工作台启用“科学材料与热学”即可为资产附加 versioned
`agentscape.simulation-profile`。材料参数、单位和计算模型随资产编译、注册和导出。
Asset Forge 的编辑器不维护另一套世界物理；编译后的资产放入普通 AgentScape 世界，由同一
`ThermalSystem` 在 `WorldRuntime.stepSimulation` 中计算。

当前仅支持 **一个资产实例对应一个均匀温度的集中参数热学体（lumped thermal body）**。
不做自动化学反应、相变、流体流动、复杂物体内部温度梯度或任意物体的材料识别。

## 定义与单位

```json
{
  "schema":"agentscape.simulation-profile",
  "schemaVersion":1,
  "model":"lumped-thermal-v1",
  "material":{
    "name":"自定义材料",
    "densityKgM3":8960,
    "specificHeatJkgK":385,
    "conductivityWmK":401,
    "provenance":"ai-estimated"
  },
  "thermal":{
    "mass":{"mode":"density-volume","volumeM3":0.001},
    "initialTemperatureK":293.15,
    "heatPowerW":100,
    "ambientTemperatureK":293.15,
    "ambientConductanceWPerK":0,
    "contactConductanceWPerK":12
  }
}
```

- `densityKgM3`：kg/m³；`specificHeatJkgK`：J/(kg·K)；`conductivityWmK`：W/(m·K)
- `mass`：可直接声明 kg，或由有效实体体积（m³）乘密度得到；不能以包围盒代替实体体积
- `heatPowerW`：外部声明的固定供热/制冷功率（W），不隐含电学供能模型
- `ambientConductanceWPerK` 和 `contactConductanceWPerK`：有效总导热系数 W/K，非材料导热系数 W/(m·K)
- `conductivityWmK` 当前只保存为材料元数据，尚未用于 v1 求解；没有几何截面积与厚度，不能直接把它换算为热通量
- `provenance` 只记录声明来源，不把 AI 估算冒充测量数据；推荐真实材料参数有可追溯来源

温度采用 K，不能低于 0。质量、热容、功率与导热系数必须有限并在 Schema 范围内。
纯热学资产没有第二个刚体。机械草稿新增 `body:'fixed'|'dynamic'`，
只允许无活动关节的草稿使用动态根刚体；机械部件的惯性仍由原有 Physics 管理。

## 数值模型

```text
质量 m = rho * V，热容 C = m * cp
每个物体： C_i * dT_i/dt = P_i + G_ambient_i*(T_ambient_i-T_i) + Σ_j G_ij*(T_j-T_i)
```

- 同一物体实例拥有唯一热学状态，不与 ObjectStore 或 Code Project 状态混存。
- 热接触只来自 Rapier 物理后端的窄相位接触对；`NEAR` 或单纯重叠的视觉模型不代表接触。
- 两个物体必须都显式声明非零接触导热系数才交换热量。
- 双边接触导热系数按有效串联热阻计算：`G_ij = (G_i * G_j)/(G_i + G_j)`，这是**简化的接触界面模型**，不是实际材料热导率的通用推导。
- 多条碰撞体接触归并为同一对物体，防止因细分 collider 而重复计热。
- 每次热学积分使用内部自适应子步进，不足以稳定时明确抛出 `THERMAL_STEP_TOO_STIFF`；不静默制造负绝对温度。
- 无环境/外部供热时，相互接触物体的总显热能量守恒。仅计算常量热容相对于 0 K 的模型化显热 `C*T`。
- 世界对象进行统一缩放时，热学质量和热容跟随几何体积按比例三次方缩放（视作生成另一个同材料尺寸的物体，不表示物理形变）。
- 暂时停用的世界实体会暂停热学积分，重新激活后保持停用前的温度。

## 查询、控制和持久化

```js
const entity=scene.inspect('copper_01');
// entity.simulation.model === 'lumped-thermal-v1'
// entity.simulation.state.temperatureK / internalEnergyJ / massKg / heatCapacityJPerK

const temperature=world.semantic.state('copper_01','temperatureK',{source:'simulation'});
// {kind:'state',status:'known',source:'simulation',value:...,evidenceKind:'owner-state'}

world.thermal.setHeatPower('copper_01',500); // 当前仅程序化 Runtime API
world.stepSimulation(1/60);
const saved=world.serialize();
await world.restore(saved); // 重新生成资产实例并恢复温度与热功率
```

`scene.observe()` 的普通对象条目和对象分页也带上仿真摘要；没有热学资产保持原有结构。
每条世界实例在快照中可包含 `simulation`：
`agentscape.thermal-state` v1，记录温度 K 和当前热功率 W。该状态只在有相应 Simulation Profile 的资产上有效；
不合法的状态在世界恢复前被拒绝。

## 已知限制与下一步

1. 目前只是可计算的热学模型，不能直接宣称某种物品真实“煮熟”“熔化”或发生化学反应。
2. 容器内部传热、辐射、相变、热容随温度变化、化学反应和电学功率网络尚未实现。
3. 初版一个资产只有一个 lumped thermal body：复合机构的不同零件还没有各自独立的温度节点。
4. 虽然资产字段支持温度、材料等声明，工作台目前只提供基础参数编辑，没有独立科学仿真曲线实验台。
5. `world.thermal.setHeatPower` 是程序化 Runtime 接口；未来需与项目行为、语义条件或授权的 MCP 动作结合，才能让外部 AI 对已实例化资产直接调节功率。

跨对象关系依赖同一 Physics 接触事实，而不是类型名称配对。物理接触与可计算热状态构成独立、可选的热学能力；不再规划热化学多求解器的组合。
