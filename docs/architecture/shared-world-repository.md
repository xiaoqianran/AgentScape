# 统一 WorldRepository：跨浏览器版本发布（第一阶段）

这一阶段实现**显式发布的跨浏览器世界版本**。它不是实时多人协作、不是浏览器间的自动同步，也不会把 AI 代码当成可信代码执行。

## 当前的数据边界

| 逻辑对象 | 创建和修改 | 本机缓存 | 共享服务器 |
| --- | --- | --- | --- |
| 完整代码世界 | `CodeProject.createProject(THREE)` + Native Scene Editor Overlay | `agentscape-code-projects` IndexedDB | `kind=code-project` |
| 创作草稿 | `AuthoringWorldController` + `AuthoringDocument` | `agentscape-world-authoring` IndexedDB | `kind=authoring-draft` |
| 运行中 Three.js Object3D | 每个 WorldRuntime / NativeSceneHost | 内存中的真实对象 | **不保存对象引用**；保存经验证的源码、编辑覆盖和 Runtime 快照 |
| Undo/Redo | 每个 WorldRuntime 的 `CommandHistory` | 仅当前会话 | **不跨运行会话共享历史** |

共享目录索引只存 `id`、`kind`、`name`、`version`、时间、字节数和 SHA-256 内容摘要。内容被切分为不超过 1 MiB 的哈希块，复用 `WorldStorage` 和 `WorldDiskStorage`。写入前进行格式与大小验证，写入块之后才会把世界版本指针原子重命名发布。服务器重新启动后，记录继续存在。当前公开的是**最新版本指针**，旧内容块并不等于可查询的历史版本记录；历史版本浏览和回滚属于下一步工作。

本阶段不强制把完整 Three.js 程序转换成 AuthoringDocument，也不强制两种编辑器使用同一种具体数据结构。

## 运行配置

Vite 开发服务（以及其 preview 模式）自动挂载以下同源 API：

- `GET /api/studio/worlds?kind=code-project`：分页列举共享世界元数据
- `GET /api/studio/worlds/<world-id>`：读取已发布的完整版本，逐块验证 SHA-256
- `PUT /api/studio/worlds/<world-id>`：明确授权发布，必须携带 `Authorization: Bearer <令牌>`，并在请求体中携带 `kind`、`baseVersion` 和 `content`

在部署服务端的环境中，设置：

```dotenv
AGENTSCAPE_WORLD_REPOSITORY_DIR=/path/to/persistent/worlds
AGENTSCAPE_WORLD_REPOSITORY_TOKEN=<generate-a-unique-random-secret-of-at-least-20-characters>
```

**没有令牌时只能读取，不能发布（HTTP 503）。** 必须由实际服务器管理员保管该令牌。前端提供密码输入框，令牌不进入项目文件、IndexedDB 或源码；禁止将令牌设置成 `VITE_` 环境变量（会暴露在浏览器构建中）。

默认目录是仓库根目录 `.studio-world-repository/`，已加入 `.gitignore`。该目录必须放在受控的、可持久化的服务器磁盘或卷上，不应直接对外作为静态目录提供下载。静态托管的 `dist` **不会**自行产生 Node HTTP API，生产环境必须运行对应的受控服务端或提供等效接口。

## 发布与恢复

**代码世界：** 在 Studio 打开并运行可信代码 → 选择「源码」 → 输入管理员发放的共享发布令牌 → 点击「发布 / 更新共享世界」。系统保存包含 `source/files/resources/state/runtime/edits` 的完整 `CodeProject`，将其发布为不可变版本。

**创作草稿：** 保存本机创作草稿 → 世界工作台 → 「我的草稿」 → 输入共享发布令牌 → 「发布共享版本」。

**另一台浏览器：** 世界工作台 → 「共享世界」 → 选择世界。代码世界导入当前浏览器后，**不自动执行来源不明的 JavaScript**，必须由用户确认后点击「运行代码世界」；创作草稿则使用原来的 AuthoringDocument 加载机制。

默认保留本机已有同 ID 项目的本地修改：不会自动覆盖。如果本机尚无该 ID 才导入对应共享版本。需要主动同步时，应先保存或导出本机内容，避免数据丢失。

## 并发、安全与限制

- 首次创建要求 `baseVersion:null`，更新要求 `baseVersion` 与最新版本相等。冲突返回 HTTP 409，不能静默覆盖另一浏览器修改。
- 每世界创建/发布使用独立的排他锁文件（`wx`）。发布中断可能留下锁文件，此时管理员排除仍运行的写入进程后才能清除。
- 单个世界最多 24 MiB，最多 128 个共享条目。此上限是本阶段的演示与本地服务安全约束，不适合超大型项目和大体积 GLB 资产。后续可以使用更成熟的对象存储后端、身份认证和存储配额。
- 服务端当前为单工作区、共享发布令牌模型，**还不具备多用户身份、项目级 ACL、差异合并和审计保留**。所有有权访问同一部署的浏览器可以读取已发布的世界源码；仅向可信成员发布不应公开的代码。
- 真实代码运行仍需要浏览器的明确授权，不宣称是沙箱。
- 原来的本机草稿、代码世界数据库和 Git 仓库不会自动迁移、删除或覆盖。
- 每世界 Undo/Redo 仅针对当前会话操作。项目重运行时保留编辑结果，不重放旧命令历史，避免引用上一个 Runtime 的 Object3D。

## 主要验证

`tests/server/world-repository.test.js`（哈希、版本、跨实例读取、HTTP 授权、创作草稿），
`tests/integration/native-code-scene-history.test.js`（Native+Managed 撤销重做），
`tests/mcp/studio-auto-connect.test.js`（真实 MCP History），
`tests/browser/studio-shared-world-repository.spec.js`（不同浏览器上下文出版与恢复），
`tests/browser/studio-scene-history.spec.js`（GUI 历史按钮）。
