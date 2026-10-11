# AgentScape 设计系统

**Studio** 与 **Observatory** 的权威视觉规范见 [`../DESIGN.md`](../../DESIGN.md)。

`apps/studio/` 与 `apps/observatory/` 的所有前端工作应把该文件作为以下方面的真相源：

- 颜色 token 与色调层级；
- Inter / JetBrains Mono 字体排印；
- 8px 间距节奏与响应式 margin/gutter；
- 玻璃拟态（glassmorphism）与色调化层级（tonal elevation）；
- 圆角组件几何；
- 按钮、输入框、卡片、chip、badge、列表状态。

当实现约束与昂贵效果冲突时（例如在 WebGL 旁大面积 backdrop blur），应在选择更低成本的渲染技术的同时保留视觉层级与 token 系统。

## 语言

- 产品 UI 可见文案默认使用简体中文；API 名称、后端名称、对象 ID、文件格式、代码符号等稳定的技术标识符可保留其规范拼写。
