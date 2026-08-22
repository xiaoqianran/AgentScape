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
