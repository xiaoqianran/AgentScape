# Asset Forge P1：多部件材料热学与实验工作台

## 使用流程

进入 Studio → 资源库 → 创建机械资产 → 启用“科学材料与热学”，然后选择“升级为多部件独立热学网络”。
每个带旋转铰链或滑轨的物理部件对应一个独立热学节点。分别设置材料密度、比热容、热质量、
初始温度、加热功率、环境温度以及有效接触换热参数；通过内部连接的 W/K 参数控制部件间导热。
资产仍通过现有 GLB 编译、隔离物理验证、物理世界放置，不额外创建第二套世界。

放入场景后，打开资源库 → 热学实验台：选择最多四个实例，查看各节点温度 K、显热能量 J 随仿真时间变化的曲线。
可以按部件筛选曲线、设置指定热节点的供热功率、推进真实世界固定时步（每次最多 10 秒）。

可导入的资产示例：
- examples/asset-forge/thermal-hinged-door.json：热学独立的钢框架与木门铰链
- examples/asset-forge/thermal-block.json：旧版单节点材料资产

## 版本化模型

v1：agentscape.simulation-profile / schemaVersion 1 / lumped-thermal-v1，旧字段保持不变。
v2：agentscape.simulation-profile / schemaVersion 2 / thermal-network-v1，使用 nodes 和 links。

~~~json
{
  "schema":"agentscape.simulation-profile",
  "schemaVersion":2,
  "model":"thermal-network-v1",
  "nodes":[
    {"id":"root","partName":"$root",
      "material":{"name":"框架","densityKgM3":7850,"specificHeatJkgK":490,"provenance":"authored"},
      "thermal":{"mass":{"mode":"explicit","massKg":4},"initialTemperatureK":340,"heatPowerW":0,"ambientTemperatureK":293.15,
        "ambientConductanceWPerK":0,"contactConductanceWPerK":10}},
    {"id":"door","partName":"door",
      "material":{"name":"门板","densityKgM3":600,"specificHeatJkgK":1600,"provenance":"authored"},
      "thermal":{"mass":{"mode":"explicit","massKg":3},"initialTemperatureK":295,"heatPowerW":0,"ambientTemperatureK":293.15,
        "ambientConductanceWPerK":0,"contactConductanceWPerK":5}}
  ],
  "links":[{"from":"root","to":"door","conductanceWPerK":8}]
}
~~~

- 根节点固定使用 id root、partName $root；其他 partName 必须指向资产 Manifest 的真实物理部件
- 每个物理部件最多一个热学节点，节点名、连接、材料属性、SI 单位和有效质量都经过 Schema 校验
- 内部导热仅来自明确声明的 links；不会由材料导热系数 W/(m·K) 自动编造有效 W/K
- 两个**不同物体实例**之间的传热必须由真实 Rapier 窄相位**部件级**碰撞接触证明，且双方非零接触导热
- 内部和外部每一条导热连接都是双向对称交换，能量不凭空产生；显式步进有数值稳定性上限
- 热学质量与刚体动力学质量暂独立建模：机构部件的碰撞、移动仍由原有 Rapier 处理。热模型不是实际材料精度的证明

## AI / MCP

scene_thermal 使用当前 Studio 场景或用户拥有的离线 worldSessionId；不需要微调模型。
通过现有权限、WorldRuntime 和 SceneFacade 调用，不制造第二份模拟状态。

~~~json
{"operation":"list"}
{"operation":"inspect","targetId":"machine_01"}
{"operation":"series","targetId":"machine_01","limit":240}
{"operation":"setPower","targetId":"machine_01","nodeId":"door","powerW":200,"requestId":"<UUID>"}
{"operation":"run","durationSec":2,"requestId":"<UUID>"}
~~~

写操作必须包含 UUID requestId；请求由现有 Scene Session 授权并去重。
read-only 的 list、inspect、series 能查看真实节点状态和时间序列。run 使用固定 1/60s 时间步推进 WorldRuntime，
暂时暂停自动时间轴并在结束后恢复。AI 可执行“设置功率 → 运行 → 读取曲线 → 修改参数”。

## 存档、曲线与模型局限

v1 状态保持原样。v2 状态采用 agentscape.thermal-state / schemaVersion 2，
每节点存储温度和功率；恢复前校验保存节点与资产节点完全一致，错误存档会在破坏性恢复前被拒绝。
曲线每 0.1 仿真秒采样一次，每实例最多缓存 600 个点，series 只能请求 1–600 点。
**曲线历史是临时实验记录，不写进世界快照**：场景重开后从恢复温度重新开始记录，防止存档持续膨胀。

尚不支持材料真实内部温度梯度、基于真实接触面积的热导率推算、热辐射、相变、化学反应、
温度相关比热、电学发热网络以及高保真多物理场。界面必须把结果标为声明模型的数值仿真而非测量数据。
