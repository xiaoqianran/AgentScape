---
name: Frappé Ethereal
colors:
  surface: '#0e1223'
  surface-dim: '#0e1223'
  surface-bright: '#34384b'
  surface-container-lowest: '#090d1d'
  surface-container-low: '#171b2c'
  surface-container: '#1b1f30'
  surface-container-high: '#25293b'
  surface-container-highest: '#303446'
  on-surface: '#dee1f9'
  on-surface-variant: '#c4c6d1'
  inverse-surface: '#dee1f9'
  inverse-on-surface: '#2c3041'
  outline: '#8e909b'
  outline-variant: '#434750'
  surface-tint: '#aec6ff'
  primary: '#aec6ff'
  on-primary: '#022e6a'
  primary-container: '#8caaee'
  on-primary-container: '#1a3d7a'
  inverse-primary: '#3e5d9c'
  secondary: '#c1c2f8'
  on-secondary: '#2a2c58'
  secondary-container: '#434573'
  on-secondary-container: '#b3b4e9'
  tertiary: '#a8d38b'
  on-tertiary: '#153802'
  tertiary-container: '#8cb671'
  on-tertiary-container: '#24470f'
  error: '#ffb4ab'
  on-error: '#690005'
  error-container: '#93000a'
  on-error-container: '#ffdad6'
  primary-fixed: '#d8e2ff'
  primary-fixed-dim: '#aec6ff'
  on-primary-fixed: '#001a43'
  on-primary-fixed-variant: '#244582'
  secondary-fixed: '#e1e0ff'
  secondary-fixed-dim: '#c1c2f8'
  on-secondary-fixed: '#151642'
  on-secondary-fixed-variant: '#414270'
  tertiary-fixed: '#c3efa4'
  tertiary-fixed-dim: '#a8d38b'
  on-tertiary-fixed: '#092100'
  on-tertiary-fixed-variant: '#2c4f16'
  background: '#0e1223'
  on-background: '#dee1f9'
  surface-variant: '#303446'
typography:
  headline-xl:
    fontFamily: Inter
    fontSize: 40px
    fontWeight: '700'
    lineHeight: 48px
    letterSpacing: -0.02em
  headline-lg:
    fontFamily: Inter
    fontSize: 32px
    fontWeight: '600'
    lineHeight: 40px
    letterSpacing: -0.01em
  headline-md:
    fontFamily: Inter
    fontSize: 24px
    fontWeight: '600'
    lineHeight: 32px
  body-lg:
    fontFamily: Inter
    fontSize: 18px
    fontWeight: '400'
    lineHeight: 28px
  body-md:
    fontFamily: Inter
    fontSize: 16px
    fontWeight: '400'
    lineHeight: 24px
  body-sm:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: '400'
    lineHeight: 20px
  label-md:
    fontFamily: JetBrains Mono
    fontSize: 14px
    fontWeight: '500'
    lineHeight: 20px
  label-sm:
    fontFamily: JetBrains Mono
    fontSize: 12px
    fontWeight: '500'
    lineHeight: 16px
rounded:
  sm: 0.25rem
  DEFAULT: 0.5rem
  md: 0.75rem
  lg: 1rem
  xl: 1.5rem
  full: 9999px
spacing:
  base: 8px
  margin-mobile: 16px
  margin-desktop: 32px
  gutter: 24px
  container-max: 1200px
---

## 品牌与风格

本设计系统采用柔和暗色（soft-dark）美学，以低视觉疲劳的对比度与舒心的冷色温为特征。目标受众包括开发者、创意专业人士与习惯夜间工作的重度用户，他们重视长时间专注与高度视觉精致度。

风格是 **极简主义（Minimalism）** 与 **玻璃拟态（Glassmorphism）** 的混合。它利用半透明图层与背景模糊营造环境纵深感，而不依赖高对比阴影的生硬感。期望带来的情绪反应是平静、精确与数字舒适。

## 颜色

调色板植根于 Catppuccin 的 Frappé 风味，以去饱和的蓝灰色基底为主，开阔而清凉。

- **主色（Primary，蓝）：** 用于主要操作与激活态。
- **辅助色（Secondary，薰衣草）：** 用于辅助 UI 元素与装饰性高亮。
- **表面（Surface，Crust）：** 用于凹陷容器与背景层。
- **文字与次文字：** 通过从高可读性的 Text 到柔和 Subtext 的过渡建立层级。

## 字体排印

字体排印在系统化的 **Inter**（用于所有功能性 UI 与正文）与 **JetBrains Mono**（用于技术标识符、数据点、代码片段）之间拆分。

标题使用紧凑的字距，保持现代、"锁定"的外观。正文在暗色背景上保持宽松的行高以确保可读性。移动端 `headline-xl` 应缩放至 32px，`headline-lg` 至 28px。

## 布局与间距

布局遵循 **流体网格（fluid grid）** 模型，以 8px 为基础节奏，确保跨组件对齐一致。

- **桌面：** 12 列网格，32px margin，24px gutter。
- **平板：** 8 列网格，24px margin，16px gutter。
- **移动：** 4 列网格，16px margin，16px gutter。

大容器使用主背景色，内部模块使用 Surface（Crust）色，形成清晰的"雕刻"视觉层级。

## 层级与纵深

纵深通过 **玻璃拟态** 与 **色调图层（Tonal Layers）** 营造，而非沉重阴影。

- **一级（Base）：** #303446（Base）。
- **二级（凹陷）：** #292c3c（Crust）。
- **三级（抬升）：** 半透明白色（5% 不透明度）叠加，配 `20px` 背景模糊。保留给模态框、导航栏与浮动操作菜单。
- **边框：** 用 1px 实线边框代替阴影，使用 Subtext 色 10% 不透明度柔和界定边缘。

## 形状

设计系统采用 **圆角（Rounded）** 形状语言，强化"温和"的品牌个性。

- **标准按钮与输入框：** 16px（1rem）圆角。
- **小组件（Chip/Badge）：** 完全胶囊形。
- **大容器（卡片/模态框）：** 24px（1.5rem）圆角，形成柔和友好的结构。

## 组件

### 按钮

- **主按钮（Primary）：** 填充主色（蓝），文字用 Base（#303446）以获得最高对比。
- **次按钮（Secondary）：** 以辅助色（薰衣草）40% 不透明度描边，文字用辅助色。
- **幽灵按钮（Ghost）：** 无背景，文字用 Subtext。悬停时应用 10% 主色色调背景。

### 输入框

- **字段（Field）：** 背景用 Surface（Crust），16px 圆角，1px 边框使用 Subtext 20% 不透明度。
- **聚焦态：** 2px 边框使用主色（蓝），并带微妙外发光（4px 模糊，同色）。

### 卡片

- **样式：** 背景色 #292c3c（Crust）。
- **交互态：** 悬停时亮度提高 5%，若卡片浮动则加 12px 背景模糊。

### Chip 与 Badge

- **状态：** 使用 Accent（成功）、Warning、Error 色 15% 不透明度作背景，同色满饱和度文字作标签。标签应使用高可读等宽字体。

### 列表

- 用 Crust 色 1px 细分隔线分隔列表项。激活项在左缘使用 4px 竖"胶囊"指示条，用主色。

## 语言与本地化

- Studio 与 Observatory 中所有可见产品 UI 文案默认使用 **简体中文**。
- 当翻译会降低精度时，规范技术标识符可保留原拼写，包括 API/函数名、后端/运行时名、对象 ID、文件格式、协议名与快捷键。
- 当技术术语需要解释时，优先使用中文标签并在括号中给出规范标识符，例如 `获取边界（getBounds）`。
