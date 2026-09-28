# Spline Home

独立前端，高保真复刻 `app.spline.design/home`。技术栈对齐原站：**React + CSS Modules + Spline Sans**（原站为 Next.js + CSS Modules，此处用 Vite 承载同一组件/样式模型）。

与 `apps/studio`、`apps/observatory` 无耦合。

## 运行

```powershell
cd apps/spline-home
# 依赖用仓库根目录的 react / vite
$env:NODE_PATH = "D:\Users\yuminghui\AppData\Local\Programs\Xiaomi MiMo\resources\runtimes\win32-x64\node\node_modules"
# 或直接用根 node_modules：
node ../../node_modules/vite/bin/vite.js
```

在仓库根（已有依赖）也可：

```powershell
node node_modules/vite/bin/vite.js --config apps/spline-home/vite.config.js
# http://127.0.0.1:5175/
```

## 结构

```
apps/spline-home/
  index.html
  vite.config.js
  src/
    main.jsx
    App.jsx
    App.module.css
    styles/
      tokens.css      # 设计 token（色板 / 圆角 / 阴影 / 时长）
      global.css      # 字体 @font-face + reset
    fonts/            # Spline Sans / Mono woff2
    components/
      UserSidebar.jsx + .module.css
      CreateActions.jsx + .module.css
      HomeRecents.jsx + .module.css
      HomeHero.jsx + .module.css
      DropdownMenu.jsx + .module.css
      icons.jsx
    data/home.js
```

## 对齐原站的样式细节

| 项 | 值 |
| --- | --- |
| 字体 | Spline Sans（可变 300–700） |
| 背景 / 文字 | `#1e1e1e` / `rgba(255,255,255,.92/.7/.52)` |
| 行 hover | `background 0.15s` |
| Chip | `background,color 0.15s`，圆角 20px |
| Prompt | `box-shadow inset 0 0 0 1px rgba(255,255,255,.05)`，focus 加深 |
| Refer 按钮 | `0 2px 8px rgba(0,0,0,.1)` |
| 菜单 | 12px 圆角 + 入场 pop |
| 列宽 | Recents 664 / Composer 640，内容列对齐 |

## 组件命名

与原站 CSS Modules 品牌一致：`UserSidebar`、`PageHeader`、`HomeHero`、`HomeRecents`、`CreateActions`、`DropdownMenu`。
