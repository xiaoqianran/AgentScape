# PR-06：原生复杂资产、大型世界与失败清理验收

本验收的目标是验证 **外部 Three.js 资源仍属于宿主**，而 AgentScape 只管理自己的碰撞注册、实体和 Overlay。它是可重复的 CPU/Runtime/存储集成回归，**不是** GPU FPS、显存或线上并发服务 SLO。

## 本轮已实际覆盖的场景

| 场景 | 输入与检查 |
|---|---|
| 真实 GLB 宿主 | 使用仓库已有 `public/assets/cabinet.glb`（1,992 字节、2 个 Mesh），由真实 GLTFLoader 解析；克隆出 100 个原生 Mesh，显式登记 17 个碰撞体，挂载/卸载 4 次。验证宿主对象、共享 Geometry/Material 与 Renderer 不被释放或替换 |
| 高面数 GLB | 在测试中按 glTF 2.0 规范生成 1,171,280 字节的有效自包含 GLB：32,761 顶点、64,800 三角面。用真实 GLTFLoader 解析并实际注册 Rapier 静态三角网格，卸载后宿主网格完好 |
| 大型 Overlay | 1,024 个唯一实体，其中 128 个活动物理实例、896 个休眠占位。完整保存并在有界激活预算下恢复，检查所有 ID、物理条目上限和未保存对象被移除 |
| 复杂机械资产 | 经真实机械编译流程生成多部件 GLB，具有柜门与抽屉等 4 个物理部件；保存、重新准备及恢复后，部件与碰撞注册仍存在 |
| 故障注入 | 在资源块读取中途注入错误；确认当前 Runtime 快照不变。环境创建失败、环境插件 ID 不匹配时，验证准备阶段资源只释放一次 |
| 大文件内容块 | 复用既有 `tests/integration/world-storage.test.js`：70 MiB 内容资源流式分块、哈希去重、归档导出导入及损坏检测。该测试验证存储能力，不代表 70 MiB GLB 已加载到渲染器 |

## PC2 本地测量样本

测试输出以 `[native-heavyworld]` 开头，运行时自动记录当前样本值。一次 PC2 Windows/Node/Vitest 样本（不是性能承诺）：

| 测量项 | 样本 |
|---|---:|
| 100 个原生 GLB Mesh、4 次挂载/卸载 | 约 120 ms |
| 1.17 MB、64,800 面 GLB 注册到静态物理 | 约 64 ms |
| 1,024 个实体创建（128 活动、896 休眠） | 约 199 ms |
| Overlay 写入和隔离验证 | 约 40 ms |
| Overlay 恢复 | 约 61 ms |
| 保存后内容块数量 | 13 |

这些数值会随硬件、Node/Vitest/JIT、活跃实体数量和资产复杂度变化。测试**不对耗时设硬编码阈值**，只对资产一致性、物理与保存正确性设断言。CI 应保留测试输出，实际发布前另进行独立 GPU 性能测试。

## 执行

```bash
npm ci
npm run test:native-heavyworld
npm run check
npx playwright test tests/browser/native-scene.spec.js
npm run sdk:verify
```

## 修复说明与剩余边界

此前 `application/scene/WorldIO.js` 的 `prepareWorld()` 在完成 AssetModule 创建后，如果资产流式校验、环境插件创建或环境 ID 校验失败，资源尚未提交却没有统一的 glTF Loader 释放路径。PR-06 新增准备阶段异常清理，保留原始异常并释放未提交资源；成功准备后的 `dispose()` 与提交失败回滚仍使用原有机制。

尚未覆盖贴图密集/骨骼动画的超大第三方资产在真实 GPU 上的运行表现、1,024 个对象全部同时活动的帧率，以及长期连续运行数小时的内存曲线。不能把这一批通过解读为这些场景已达到生产性能水平。
