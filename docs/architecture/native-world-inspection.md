# 原生代码世界观察与时间控制

## 单一入口

这些能力直接读取可信 Three.js 项目的真实 Scene / Camera / Renderer，而不是创建另一套场景模型。不要求 registerEntity 或 registerEditable；语义交互与几何观察保持不同职责。

- studio_project inspect：expectedRevision 必填；建议使用 expectedRuntimeId 和 expectedSceneRevision 绑定当前运行实例及场景树版本。nodePath 使用从场景根开始的子索引路径，运行实例或动态树变更后必须重新观察。limit 为 1-64，offset 用于分页。
- studio_project search：query、objectType、material 可组合；visibleOnly 过滤有效可见节点。默认排除 Studio 自身的 Transform Gizmo / 编辑轮廓辅助节点；调试时可传 includeInternal=true。最多扫描 8192 个节点，返回分页 nodePath、世界位置、材质名称及基础几何统计。nodePath 是可变的子索引路径，而非稳定身份；搜索与检查同时返回 objectUuid。
- studio_project inspect_batch：一次同步观察 1-8 个路径。每条路径限制 1024 节点、187500 顶点、62500 个估算三角形及 6250 个实例，总预算分别为 8192 节点、150 万顶点、50 万三角形及 5 万实例。可选择材质、灯光摘要；visibility 模式最多 4 条路径。
- includeMaterials=true：最多返回 32 个不同的材质及使用对象数、PBR 标量/颜色和贴图元数据；每对象最多检查 16 个材质槽。truncated 表示摘要不完整。不读取像素、URL、任意 userData 或 shader 源码。
- includeLights=true：最多返回 32 个原生灯光的类型、颜色、Three.js intensity、世界位置/方向、距离、聚光参数和阴影配置。强度是 Three.js 原始数值，不转换为 lux，也不代表最终屏幕照度。
- visibility=true：对当前或指定 view 的目标投影包围盒执行 7×7 有界射线采样。返回 targetHits、visibleHits、occludedHits、visibleFraction 和最多八个遮挡 Mesh 的路径。只考虑可支持的不透明静态 Mesh，限制 4096 节点、5 万三角形与 187500 顶点。透明、蒙皮、变形、自定义射线、着色器、Line/Points、裁剪等不能可靠计入时报告 partial/not-sampled 及原因。比例是采样命中比例而不是精确像素可见面积，不能单独作为质量或物理通过证据。
- studio_project suggest_views：为一个目标生成 2-12 个候选机位，默认按 5×5（可调 3-7）不透明 Mesh 射线采样比例排序，返回可复现 position/target/fov、遮挡对象和限制。它不是精确像素可见性、没有光照/审美评价，也不保证遮挡透明或自定义 Shader 的目标。
- capture：imageMode=mcp 返回真实 JPEG MCP 图片内容；view 可传相机 position/target/fov，也可传 nodePath/direction/padding 自动构图。isolateNodePath 可与 view 配合（省略 view 时自动构图）。隔离只在同步直接 WebGL 渲染期间临时清除非目标渲染对象的 layer mask，保留灯光和树关系，finally 恢复；随后重绘原主视图。独立/隔离视图不包含项目的自定义后处理，不是正常场景可见性的证明。
- timeline：command=status/pause/resume/step；steps=1..120，必须先 pause 再 step。暂停后 RAF 不推进项目 update 或 Runtime 仿真；step 按 Runtime fixedDt 调用项目 update 和实际 Scene.step，结束后渲染。恢复时重新建立真实时间基准，不追赶暂停期间的墙钟时间。status 和截图附带运行实例的 elapsedSeconds、frames 及 simulation.tick/time/fixedDt；播放控制属于当前会话，不写入项目文件。不能控制外部 setTimeout、网络、用户自建 RAF 或 render 中的副作用；不是通用反向/随机 seek，也不是对任意物理场景可重复性的保证。

GUI 的原生对象搜索、批量检查和最佳机位预览调用同一 StudioCodeProjects API，不创建第二套对象树。时间暂停前要求 Scene 空闲；暂停时 MCP scene_interact 返回 PROJECT_PLAYBACK_PAUSED，先恢复再执行动作。expectedRuntimeId 和 expectedSceneRevision 校验运行实例与受管版本；原生代码直接改变 children 不一定增加版本。因此后续 inspect / suggest_views 传入 objectUuid，inspect_batch 传入与 nodePaths 对齐的 objectUuids，view 中传入 objectUuid，隔离截图传入 isolateObjectUuid。若同一路径指向另一个对象，返回 NATIVE_INSPECT_OBJECT_CONFLICT；旧的仅路径请求仍兼容，但没有身份保证。对象 UUID 仅在当前原生对象生命周期内稳定，不是跨运行持久化 ID。

## 独立观察服务

application/native-scene/SceneObserver.js 提供 createSceneObserver({scene,camera,renderer}, {renderCurrent})；Studio 与 MCP 共用此服务，Engine SDK 也可直接导入。它不创建 WorldRuntime，不依赖 Studio，不需要注册语义或接管渲染循环。搜索、几何检查、批量检查、候选机位及截图共享原有有界算法。截图需要浏览器 canvas；可选 renderCurrent 用于主视图重绘，调用方不得借此推进模拟时间。

## 复现与回归

- tests/integration/scene-observer.test.js：独立观察、UUID 与路径重排保护

- tests/integration/native-scene-inspection.test.js：原生几何、实例、世界边界、自动构图
- tests/integration/native-scene-review.test.js：材质摘要、遮挡、隔离恢复、预算
- tests/integration/native-scene-query.test.js：名称/类型/材质搜索、分页、批量检查、灯光摘要、候选机位排序
- tests/integration/code-project.test.js：时间暂停、步进、保存锁、恢复
- tests/browser/studio-multi-file.spec.js：真实浏览器 HTTP MCP 图像、搜索、批量诊断、候选机位和 GUI 预览
