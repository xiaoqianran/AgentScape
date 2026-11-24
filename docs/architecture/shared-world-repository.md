# WorldRepository：跨浏览器共享与不可变历史版本

当前实现包含**显式发布的跨浏览器共享、不可变历史版本和乐观并发回滚**。它不是实时多人协作、不是浏览器间自动同步，也不会把 AI 代码当作可信代码执行。

## 当前的数据边界

| 逻辑对象 | 创建和修改 | 本机缓存 | 共享服务器 |
| --- | --- | --- | --- |
| 完整代码世界 | `CodeProject.createProject(THREE)` + Native Scene Editor Overlay | `agentscape-code-projects` IndexedDB | `kind=code-project` |
| 创作草稿 | `AuthoringWorldController` + `AuthoringDocument` | `agentscape-world-authoring` IndexedDB | `kind=authoring-draft` |
| 运行中 Three.js Object3D | 每个 WorldRuntime / NativeSceneHost | 内存中的真实对象 | **不保存对象引用**；保存经验证的源码、编辑覆盖和 Runtime 快照 |
| Undo/Redo | 每个 WorldRuntime 的 `CommandHistory` | 仅当前会话 | **不跨运行会话共享历史** |

共享目录索引只存 `id`、`kind`、`name`、`version`、时间、字节数和 SHA-256 内容摘要。内容被切分为不超过 1 MiB 的哈希块，复用 `WorldStorage` 和 `WorldDiskStorage`。写入前进行格式与大小验证，写入块之后才会把世界版本指针原子重命名发布。服务器重新启动后，记录继续存在。每次更新或回滚**先归档旧版指针，再原子替换最新指针**；这使历史版本始终可单独读取，而旧内容块也不因回滚被覆盖。

本阶段不强制把完整 Three.js 程序转换成 AuthoringDocument，也不强制两种编辑器使用同一种具体数据结构。

## 运行配置

Vite 开发服务（以及其 preview 模式）自动挂载以下同源 API：

- `GET /api/studio/worlds?kind=code-project`：分页列举共享世界元数据
- `GET /api/studio/worlds/<world-id>`：读取已发布的完整版本，逐块验证 SHA-256
- `PUT /api/studio/worlds/<world-id>`：明确授权发布，必须携带 `Authorization: Bearer <令牌>`，并在请求体中携带 `kind`、`baseVersion` 和 `content`
- `GET /api/studio/worlds/<world-id>/versions?offset=0&limit=20`：倒序浏览历史版本的元信息；返回 `latestVersion`、`total`、`versions`、`nextOffset`
- `GET /api/studio/worlds/<world-id>/versions/<version>`：读取完整历史版本，验证每个哈希块及内容 SHA-256；只返回数据，不执行 JS
- `POST /api/studio/worlds/<world-id>/rollback`：使用与发布一致的 Bearer 令牌，在请求体中提交 `{ "targetVersion":1, "baseVersion":3 }`，生成新的 v4；不是原地恢复


在部署服务端的环境中，设置：

```dotenv
AGENTSCAPE_WORLD_REPOSITORY_DIR=/path/to/persistent/worlds
AGENTSCAPE_WORLD_REPOSITORY_TOKEN=<generate-a-unique-random-secret-of-at-least-20-characters>
```

**没有令牌时只能读取，不能发布（HTTP 503）。** 必须由实际服务器管理员保管该令牌。前端提供密码输入框，令牌不进入项目文件、IndexedDB 或源码；禁止将令牌设置成 `VITE_` 环境变量（会暴露在浏览器构建中）。

默认目录是仓库根目录 `.studio-world-repository/`，已加入 `.gitignore`。该目录必须放在受控的、可持久化的服务器磁盘或卷上，不应直接对外作为静态目录提供下载。静态托管的 `dist` **不会**自行产生 Node HTTP API，生产环境必须运行对应的受控服务端或提供等效接口。

**静态路径防护：** Vite 的开发和预览中间件拒绝直接访问共享仓库目录中的原始数据文件或 /@fs/ 路径（HTTP 404），公开读取应通过经校验的 GET 世界 API。使用独立生产服务器时也必须禁止将存储目录挂为静态资源；建议持久存储放在静态网站根目录之外。

## 查看与回滚历史

在「**世界工作台 → 共享世界 → 历史版本**」展开时间线。可以倒序分页查看每次发布及回滚来源、时间和完整的 SHA-256 元数据；选择「查看 vN 内容」将读取并校验完整的历史文件，仅显示源码/创作树的**开头和末尾摘要**（不执行 JavaScript），关闭预览不会更改本机世界。代码世界还可比较两个版本的源码文件、资源、原生编辑及运行对象的增删改，并复制为具有新 ID 的独立本机草稿；共享导入和历史副本从本机目录再次打开时也不自动运行。

若要回滚，先在共享世界列表上方填写服务器发布授权令牌，选择「**回滚到 vN**」并确认。服务端再次核对预期的最新版本号，在同一世界的独占发布锁下验证历史内容，再先归档当前指针、原子发布一个新的 HEAD。例如 v3 回滚到 v1 会新建 v4，原来的 v1/v2/v3 均可继续访问。回滚完成后**不会自动覆盖本机 IndexedDB**，现有本机草稿继续保留。

在代码编辑器的「共享世界发布」下可从新标签页直接进入对应世界的历史列表，避免丢弃当前未保存的源码编辑。

**并发失败：** 409 `WORLD_REPOSITORY_VERSION_CONFLICT` 表示其他浏览器已经发布更新。请刷新历史、检查新的 HEAD 并重新确认，不要盲目使用旧版本号重试。版本损坏则拒绝回滚而非引用未验证的内容块。

## 发布与恢复

**代码世界：** 在 Studio 打开并运行可信代码 → 选择「源码」 → 输入管理员发放的共享发布令牌 → 点击「发布 / 更新共享世界」。系统保存包含 `source/files/resources/state/runtime/edits` 的完整 `CodeProject`，将其发布为不可变版本。

**创作草稿：** 保存本机创作草稿 → 世界工作台 → 「我的草稿」 → 输入共享发布令牌 → 「发布共享版本」。

**另一台浏览器：** 世界工作台 → 「共享世界」 → 选择世界。代码世界导入当前浏览器后，**不自动执行来源不明的 JavaScript**，必须由用户确认后点击「运行代码世界」；创作草稿则使用原来的 AuthoringDocument 加载机制。

默认保留本机已有同 ID 项目的本地修改：不会自动覆盖。如果本机尚无该 ID 才导入对应共享版本。需要主动同步时，应先保存或导出本机内容，避免数据丢失。

## 历史版本与无损回滚

Studio **「世界工作台 → 共享世界 → 历史版本」** 可查看当前世界的发布记录、时间、SHA-256 和历史内容摘要，可分页加载更早版本。代码世界显示原始 JavaScript，创作草稿显示 AuthoringDocument 的只读结构；浏览本身绝不执行历史代码，也不会替换本机草稿。

恢复时选择某个历史版本并确认，Studio 使用当前线上 `baseVersion` 做乐观锁校验。例如 `v1 → v2 → v3` 后从 v1 回滚，服务器会追加 **v4（恢复自 v1）**，而 v1、v2、v3 全部保留，v4 复用已校验的内容块。回滚期间其他浏览器若先发布新版本，服务端返回 **HTTP 409**，原来的最新版本不受影响，用户必须刷新历史后重新确认。

服务端持久化目录：

- `records/<world-id>.json`：唯一的**最新版本**指针，原子重命名切换
- `history/<world-id>/<number>.json`：旧版不可变指针，每次更新先持久归档，再切换最新
- `blocks/<sha256>`：通过内容哈希寻址的原始世界字节块，历史版本复用且读取时校验

**兼容旧版：** 已发布但还没有 `history/` 的 v1 原样保留。首次发布 v2 时自动把 v1 指针归档；已有 v1 的历史浏览无需迁移或再发布。

`WorldRepository` 版本历史与 `WorldRuntime.history` 是不同概念：前者保存**跨浏览器版本**，后者只负责运行中 GUI/MCP Undo/Redo，重新运行代码会清空会话级历史。回滚不会自动更新现有打开的浏览器窗口，也不会直接修改其 IndexedDB；用户应重新获取共享世界并明确运行。为避免旧本地草稿抢先覆盖刚恢复的共享 HEAD，回滚**不会自动把本机草稿的发布基线升级到新版本号**，再次发布旧草稿会收到版本冲突，必须先明确重新同步。

## 并发、安全与限制

- 首次创建要求 `baseVersion:null`，更新要求 `baseVersion` 与最新版本相等。冲突返回 HTTP 409，不能静默覆盖另一浏览器修改。
- 每世界创建/发布/回滚使用同一独立排他锁文件（`wx`）。发布中断可能留下锁文件，此时管理员排除仍运行的写入进程后才能清除。
- 单个世界版本最多 24 MiB，最多 128 个共享条目。**历史版本会持续占用服务器磁盘；当前没有自动清理/保留策略**。不要手工删除仍被历史引用的哈希块。定期同时备份 `records/`、`history/` 和 `blocks/`。此上限是本阶段的演示与本地服务安全约束，不适合超大型项目和大体积 GLB 资产。后续可以使用更成熟的对象存储后端、身份认证和存储配额。
- 服务端当前为单工作区、共享发布令牌模型，**还不具备多用户身份、项目级 ACL、差异合并和审计保留**。所有有权访问同一部署的浏览器可以读取已发布的世界源码；仅向可信成员发布不应公开的代码。
- 真实代码运行仍需要浏览器的明确授权，不宣称是沙箱。
- 原来的本机草稿、代码世界数据库和 Git 仓库不会自动迁移、删除或覆盖。
- 每世界 Undo/Redo 仅针对当前会话操作。项目重运行时保留编辑结果，不重放旧命令历史，避免引用上一个 Runtime 的 Object3D。

## 主要验证

`tests/server/world-repository.test.js`（哈希、跨实例读取、HTTP 授权），
`tests/server/world-repository-history.test.js`（历史查询、旧 v1 兼容、回滚、CAS、安全、故障注入），
`tests/integration/native-code-scene-history.test.js`（Native+Managed 撤销重做），
`tests/mcp/studio-auto-connect.test.js`（真实 MCP History），
`tests/browser/studio-shared-world-repository.spec.js`（不同浏览器上下文出版与恢复），
`tests/browser/studio-scene-history.spec.js`（GUI 运行历史按钮），
`tests/browser/studio-shared-world-history.spec.js`（双浏览器版本浏览与回滚冲突），
`tests/browser/studio-shared-authoring-history.spec.js`（创作草稿的历史回滚与跨浏览器恢复），
`tests/browser/studio-shared-history-pagination.spec.js`（分页与发布并发冲突），
`tests/server/world-repository-static-privacy.test.js`（禁止静态绕过 HTTP API 读取原始存储），
`tests/studio/shared-world-repository-history.test.js`（回滚不擅自取得本机旧草稿的最新发布权）。


**隔离浏览器验收：** 可以用 AGENTSCAPE_TEST_PORT=4187 为 Playwright 分配独立端口，构建和历史数据在忽略的临时目录内，避免与已运行的 Studio 抢占 4178 端口或覆盖共享世界数据。
