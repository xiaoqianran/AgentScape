# Scene API 服务边界

Scene API 是 SDK、MCP、Studio 共用的应用层入口；各服务负责调用真实的 `WorldRuntime`，不创建第二份对象、物理、导航或关系状态。

## 文件职责

| 文件 | 职责 | 私有状态 |
| --- | --- | --- |
| `SceneFacade.js` | 对外 API、运行时生命周期、执行互斥、revision、查询与 Scene 技能注册 | `busy`、`closed`、`revision`、`selectedActor` |
| `SceneContracts.js` | Zod 输入契约、结果错误与诊断定义 | 无 |
| `SceneEditService.js` | 资产准入、增删改、批处理、幂等请求窗口及模型编译接入 | 请求去重窗口 |
| `SceneJobController.js` | 物理/环境交互、异步 Job、取消与结果证据 | Job Map；共用 Facade 的互斥标志 |
| `ScenePersistence.js` | 快照、项目包、区块化世界存档、导入与恢复 | 无 |

## 保留的不变量

1. 外部继续调用 `scene.apply()`、`scene.addModel()`、`scene.interact()`、`scene.waitJob()`、`scene.save()` 等原始方法；`sceneAgentModelSchema`、`sceneInteractionSchema` 和 `sceneError` 仍可由 Facade 导入。
2. 批量编辑先校验所有资产，执行后按操作记录历史。某一步失败时返回已经提交的 `applied`、失败位置及 `notRun`，不将此前成功操作全部回滚。
3. 同一请求 ID 的相同操作可幂等重放，冲突请求拒绝；revision 来自原 Runtime 历史事件。
4. 执行中的 Job 占用 Facade 的互斥门；取消请求将中断信号传递至真实交互、移动和环境能力，取消后的结果不得标为已验证。
5. 存档导入继续委托原有 `WorldIO`、`ScenePackage`；世界切换、资源准入、原子发布和恢复由原实现执行，不在应用层复制状态。
6. `WorldRuntime` 仍然是世界对象、物理、导航和场景关系的唯一状态来源。多个消费者使用同一 Runtime 时，Facade 使用同一实例。

## 回归验收

运行 `npm run check`；重点覆盖 `tests/integration/scene-service-boundaries.test.js`、`scene-facade.test.js`、`scene-batched-edits.test.js`、`scene-request-window.test.js`、`scene-package.test.js`、`tests/mcp/scene-api.test.js` 和原生存档测试。

本次是职责分离，不更改公开 API，也不新增独立 Scene 状态。
