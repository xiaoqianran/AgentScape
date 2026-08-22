# 资产编译器研究记录

在实现 AgentScape Asset Compiler 前，实际拉取并用 CodeGraph 阅读了以下仓库。

| 项目 | 许可证 | 采用方式 |
| --- | --- | --- |
| allenai/objathor | Apache-2.0 | 学习分阶段资产转换与 simulator validation |
| SarahWeiii/CoACD | MIT | 作为可选重型碰撞后端 |
| donmccurdy/glTF-Transform | MIT | 直接作为 npm 依赖复用 |
| vlongle/articulate-anything | 未发现许可证 | 只学习 articulation 验证闭环，不复制源码 |

## ObjaTHOR 的关键启发

真正的资产转换不是格式转换，而是连续处理：尺度/朝向、几何清理、碰撞、annotation、可见性和最终 simulator 验证。AgentScape 采用同样的“分 Pass”思路，但目标运行时是浏览器。

## CoACD 的关键启发

碰撞几何属于编译产物，不属于渲染 Mesh。AgentScape 的 Manifest 支持 `convexHull`，Rapier 直接消费凸包顶点；服务器侧可用 CoACD 把复杂 Mesh 分解为多个凸包。

## glTF-Transform 的关键启发

成熟 glTF 基础设施应直接复用。AgentScape 使用它完成二进制读写、结构检查和 `dedup / prune / weld`，避免维护第二套解析器。

## Articulate-Anything 的关键启发

关节推断不能停在“猜一个 joint”。完整链路应该是：

```text
Parts / Links
   ↓
Joint Candidate
   ↓
可执行 articulation
   ↓
运动仿真 / 渲染
   ↓
Critic
   ↓
修正或重试
```

目前 AgentScape 只在浏览器做低置信度候选发现，真正的关节推断留给可替换 Provider。

## Parts / Joint Proposal 研究

1.3 前重新用 CodeGraph 阅读了 EmbodiedGen、SceneSmith、Articulate-Anything、SAPIEN、ManiSkill、GAPartNet 与 yourdfpy。

### 可以直接复用

- **SAPIEN**：Apache-2.0。其 articulated 表示明确保留 parent/child link、joint type、anchor pose、limits 与 drive target；用于验证 AgentScape 的多级 Link 数据模型。
- **ManiSkill**：Apache-2.0。其 ArticulationBuilder 同样按 parent link 拓扑构建 joint，并显式处理 self collision；用于架构参考。
- **yourdfpy**：MIT。直接作为服务依赖，用于 URDF 解析并输出 Part Proposal。

### 只研究，不作为默认依赖

- **GAPartNet**：代码与数据为 CC BY-NC 4.0，不适合作为 AgentScape 默认商业友好依赖。
- **PartNet-Mobility 数据**：数据许可存在额外条款与下游使用限制，不能把它当作 AgentScape 默认可再发布资产源。
- **Articulate-Anything**：研究时未发现清晰许可证，因此只采用 actor → executable articulation → simulator → critic 的思想，不复制源码。

### 最终收敛

AgentScape 不绑定某一个分割模型或数据集，而定义一个 provider-neutral `Part Proposal v1`。可信机械数据、VLM 推断、分割模型和人工标注都可以输出 Proposal；Runtime Manifest 只接收经过结构检查并满足可执行条件的 Part。
