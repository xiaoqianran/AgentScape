# 第三方依赖与架构参考

AgentScape 自身代码独立实现，并使用 `package.json` 和服务端 `requirements.txt` 中声明的依赖。

## 直接使用

- Three.js
- Rapier (`@dimforge/rapier3d-compat`)
- three-mesh-bvh
- glTF-Transform — MIT
- CoACD — MIT，可选服务端依赖
- yourdfpy — MIT，可选服务端 URDF 解析依赖

## 架构研究

- HorizonRobotics/EmbodiedGen — Apache-2.0
- nepfaff/scenesmith — MIT
- generalholography/gizmo — Apache-2.0
- allenai/objathor — Apache-2.0
- syndicalt/limina — AGPL-3.0，仅研究架构思想，没有复制源码
- wrc356/Auto-Threejs — 研究时未发现许可证，仅研究思想，没有复制源码
- vlongle/articulate-anything — 研究时未发现许可证，仅研究思想，没有复制源码

详细映射见 `docs/research/`。

## 新增架构研究

- SAPIEN — Apache-2.0
- ManiSkill — Apache-2.0
- GAPartNet — CC BY-NC 4.0，仅研究，不作为默认依赖或资产源

## 外部可选 Provider（不随 AgentScape 分发）

- Hunyuan3D-Part / P3-SAM — Tencent Hunyuan 3D-Part Community License。仅作为外部 Part Segmentation Provider 研究与协议兼容对象；默认仓库不包含其源码、权重或模型。使用者需自行遵守地域、用途与分发条款。
