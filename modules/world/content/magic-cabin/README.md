# 原版魔女小屋内容迁移

来源：工作区 `web-012-line-art-style-magic-cabin/index.html`（线稿风格魔女小屋）。保留源文件内容、陈设布局与便签中的原作者署名 `YIBI2333`，原 HTML 不修改。

来源 SHA-256：`65a6ec7adc986ba46b913f54911eafa7389a1cd6b4a17c60e2ddca0262b46691`。

`cabinContents.js` 由 `dev/scripts/migrate-magic-cabin.py` 从原 HTML 抽取场景构建与室内动画，约 6,000 行场景内容加对应动画。运行 `uv run --no-project --python 3.12 dev/scripts/migrate-magic-cabin.py` 可重新生成。需保留源 HTML 的结构标记；源文件变更后必须重新运行迁移测试。宿主适配位于 `../magicCabin.js`，Studio 的共享编辑浮层与拾取位于 `apps/studio/ui/WorldInteraction.js`（视角预设、物件目录、剖面开关与持久化键由本目录的 `magicCabin.js` 提供）。

迁移范围：

- 原木双层房屋、屋顶剖面、圆形楼板开口、旋转楼梯、门窗、烟囱、室外植物与路牌。
- 一楼餐桌、可抽取书架书本、玩具车、猫、毛线球、药剂、魔法书、暖桌、茶壶、坩埚、塔罗牌、扫帚、风铃、储物箱等。
- 二楼床、枕头、抽屉、书桌、椅子、纸牌、魔方、雪景球、沙漏、日历、魔杖、衣柜、便签板、黑板、魔法帽、纸巾盒、挂画、镜子与吊灯等。
- 150 个注册交互节点（包括多本书、多张便签与多个共用壁炉动作的节点），保留源动作及其动画。

宿主边界：

- 没有 iframe、第二个 renderer、独立 RAF 或原页面全局输入监听。动画由 `WorldRuntime.stepSimulation` 使用同一个固定时间步驱动；原动画时间与延迟回调也改用这个时钟。
- 原 GLSL FILL / LITMAT 转为生产 WebGPU / WebGL 都支持的标准材质，保留线稿、配色、透明效果和可见动画；原自定义着色器的光照不保证逐像素一致。当前不迁移原页面天气、音效、史莱姆玩家和爆裂魔法系统。
- 结构碰撞由房屋 / 楼板 / 楼梯实际几何生成；固定家具使用原 HTML 的平台体积描述。门窗与移动座椅 / 推车碰撞体随动画同步到生产 PhysicsSystem。
- 房内陈设目前属于 environment interaction，尚未逐件编译为 AssetCatalog / ObjectStore 资产，因此不冒充已经通过 Agent 抓取、carry 或完整关节验证的资产。屋外保留现有 Agent 和标准桌柜杯资产。
- 契约覆盖的门窗、抽屉、书、灯与文本已进入 SceneSerializer / Undo；其余装饰动画尚未保存。文本、图片地址和剖面偏好也在浏览器本地保存。图片直连或本地上传，不沿用源 HTML 的第三方 CORS 转发。

Agent 交互入口为 `listWorldAffordances` / `inspectWorldAffordance` / `executeWorldAction`，位于 Runtime 的 `WorldAffordances`。Studio 中契约物件与文字编辑复用该命令；装饰点击数不等于 Agent 能力数。完整方向和未验收任务见 `docs/world-first-direction.md`。

验证：`tests/world/magic-cabin.test.js` 用 Canvas 绘制桩构建真实 Three 几何、逐项调用所有注册交互并推进动画，验证文字与图片编辑；用真实 Rapier 验证 collider 准入，用真实 Recast 验证关门阻断 / 开门连通及二楼平面路径。按用户要求没有浏览器或像素验证。

已知限制：原版窄旋转楼梯对当前默认 Agent 尺寸尚未形成跨楼层 Recast 路径。保留原几何，不加入虚假的瞬移或贯穿楼板的导航连接；二楼可通过 Studio 视角切换与物件定位直接查看、交互。
