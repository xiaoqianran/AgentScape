# 程序化资产与可信世界恢复 v0.3

在现有 `agentscape-world` 中完成：Three.js 源码 → Linux 容器隔离构建 → GLB / 显式 Manifest → AssetModule → WorldCommands → WorldRuntime → 文件保存与恢复。没有第二个 MCP，也没有复制 Three.js 编辑器、物理、导航或场景序列化系统。

## 准备隔离环境

PC2 使用 Docker Desktop 的 Linux 引擎。先启动 Docker Desktop，准备官方基础镜像，然后构建固定运行镜像：

```powershell
docker pull node:24-alpine
node dev/build-programmatic-sandbox.mjs
```

构建脚本将基础镜像解析为不可变 RepoDigest。上下文是临时目录，只复制固定 QuickJS 依赖、受信任构建入口及由本项目固定 Three.js 生成的 bundle，不包含仓库、私有配置或凭据。镜像生成后把不可变 image ID 和代码 digest 保存到数据目录的 `sandbox.json`。运行期间禁止自动拉取镜像；镜像缺失、引擎不可达、Linux 不可用、镜像标签或代码 digest 不匹配时返回 `SANDBOX_UNAVAILABLE`，无进程内回退。

每次构建通过 stdin 输入，容器采用：`network=none`、只读根文件系统、UID/GID 65534、cap-drop ALL、no-new-privileges、1 CPU、256MiB 内存及相同 swap 上限、64 PID、受限 /tmp tmpfs、无宿主挂载和 Docker socket。创建后读取实际 Docker inspect 并核对这些配置，再启动构建。代码还在容器内部的 QuickJS WASM 中执行，不注入 Node、文件、网络、模块加载或环境变量接口。

默认源码执行1500ms、QuickJS分配96MiB、整个容器运行15秒。超时、输出超过4MiB或取消时杀死附着进程并强制删除容器；无法确认清理会报告 `SANDBOX_CLEANUP_FAILED`。不把正则或普通 Worker 当成 OS 隔离。

源码/运行入口更新后重新执行镜像构建脚本。容器镜像是隔离构建依赖，不是常驻服务。Docker 未运行时，原有观察和内置世界操作仍可用，所有远程源码构建明确失败关闭。

## 输入与工具

`asset_build_submit` 接收：

```json
{
  "contract":"agentscape.procedural-asset.v1",
  "source":"export function createAsset(THREE) { /* 返回 Group 或 Mesh */ }",
  "definition":{"id":"box","type":"box","label":"箱子","actions":["move"],"physics":{"body":"fixed","colliders":[{"shape":"box","halfExtents":[0.5,0.5,0.5],"translation":[0,0.5,0]}]}},
  "requestId":"<UUID>"
}
```

源码必须同步返回有效 Object3D，根变换为单位变换。支持 Mesh/Group、基础 BufferGeometry、Basic/Standard/Physical 材质与有界 RGBA DataTexture。动态脚本、事件/渲染回调、Shader、模型 URL、第三方依赖、灯光相机及蒙皮明确拒绝。源码最多32768字节，Manifest最多24576字符；原有 HTTP 64KiB 总请求限制仍然生效。

Manifest 使用既有 `validateAssetManifest()` 格式，另加远程接口字段与资源预算。输入的 `id` 是逻辑名称；`source`、最终不可变 ID、compiler、provenance 和 verification 由服务端生成，不接受客户端自证成功。声明 requiredNodes、surfaces、receptacles、physics、parts/joint/targets 和可选 interactionContract。必需节点必须唯一存在。关节不能仅靠节点命名推断为可交互。

| 新增工具 | 用法 |
|---|---|
| asset_build_submit | 提交并返回 Build ID；相同 requestId 参数冲突会拒绝 |
| asset_build_status | 查询 running / succeeded / failed / cancelled / interrupted，以及诊断、资产版本和准入 |
| asset_build_cancel | 取消自己的任务并终止构建容器 |
| asset_publish | 发布成功构建；非 ready 默认拒绝，provisional 必须显式选择编辑态 |
| asset_inspect | 查看自己的源码（可选）、Manifest、哈希和运行验证 |
| asset_list | 分页查询自己的已发布版本 |
| world_save | 保存当前会话，返回服务端 saveId |
| world_restore | 用自己的 saveId 和新 requestId 创建恢复会话，不接受磁盘路径 |

原16工具保留，共24工具。`action_execute` 原六种动作保留，新增 `replaceAsset`；`spawnAsset` 仅允许内置资产、当前会话创作资产，或当前身份已发布的资产。新发布资产在使用时注册到现有会话；新会话和恢复会话按需加载，不把整个资产库复制为另一份世界状态。

provisional 发布用于保留和审查，不提升准入。当前发布资产的 `spawnAsset` / `replaceAsset` 要求 ready；草稿编辑态继续使用原 authoring 接口。

构建不占用某个世界的互斥锁；最多4个并行构建，每身份最多2个。客户端应查询状态而非阻塞一个长 HTTP 请求。同一身份、相同内容的并发普通构建共用任务；不同 requestId 可复用已存在版本。`forceRebuild=true` 强制重建并校验相同版本产物；不一致返回 `BUILD_NONDETERMINISTIC`，保留旧产物。

## 实际调用顺序

真实示例位于 `apps/mcp-server/examples/procedural-assets.js`，包含箱子、带 top 支撑面的桌子、可开关门的冰箱。

1. 使用示例 source/definition 调用 `asset_build_submit`，轮询状态。
2. 成功后调用 `asset_publish`，取得 `pa_<SHA256>` Asset ID。
3. 创建会话；通过 `action_execute(skill="spawnAsset",args={assetId,instanceId,position})` 加入世界。
4. 通过原 navigate / approachAndPickup / approachAndPlace / approachAndInteract 操作。
5. 通过参数化 `world_verify.criteria` 检查目标实体与物理关系。
6. `world_save` 保存；服务重启后 `world_restore` 恢复为新的私有会话。

资产采用既有 GLB 导出与 AssetCompiler。显式定义替换推断碰撞与语义，仍经过几何、资源预算、Schema 和加载验证。物理注册和关节开/关目标在既有隔离 Rapier 验证器执行，证据写回 Manifest；构建成功、资产准入与世界动作完成依然是三个独立事实。

## 不可变版本与升级

版本取决于原始源码、规范化 Manifest 和构建环境，包括固定容器 image/digest、Three.js版本、编译/验证源码和依赖锁文件的 digest。逻辑 id 可以相同，版本修改后生成新 Asset ID。不会覆盖 GLB，也不会自动升级世界中的旧实例。

显式执行 `action_execute(skill="replaceAsset",args={id,assetId})` 升级实体。保留实例 ID、位置、旋转与缩放，重置交互状态；不支持直接升级 Agent embodiment，不允许替换正在持有的对象。通过 WorldCommands 事务执行，新资产放置或导航检查失败则恢复原实体和物理体。物理形状完全相同的非关节资产保留已有接触，不因求解器接触容差误拒绝纯材质升级。

## 持久化与生命周期

默认目录 `D:\AgentScapeData\mcp-assets`；CLI 可设置 `AGENTSCAPE_MCP_DATA_ROOT`。测试与其他设备应显式使用独立 dataRoot。单个数据目录由一个 MCP 写入实例管理，不支持多进程共享写入。

```text
mcp-assets/
  sandbox.json
  owners/<身份SHA256>/
    assets/pa_<版本>/
      source.js
      asset.glb
      manifest.json
      build.json
      published.json
    builds/<Build-ID>
    requests/<requestId>
    worlds/<saveId>
```

资产临时目录写完并复核后原子发布，发布标识与已完成构建分离；不同内容不得覆盖同一版本。读取和恢复时复核源码、定义、GLB 和 Manifest 哈希、身份、格式与当前支持的 Three.js版本。不会执行保存文件中的源码。快照通过现有 SceneSerializer 恢复，资产依赖必须能解析；导入失败关闭新会话，不破坏其他世界。历史交互验收记录不作为恢复后的新动作证据，恢复后重新运行验收或动作。

内存世界关闭或TTL到期会释放；已保存资产和世界不会随会话删除。进程退出时构建任务取消；异常退出后遗留 running 记录变为 interrupted，不自动执行旧源码。默认保留所有已发布版本和世界存档，旧版本由快照依赖明确引用，不自动垃圾回收，避免删除仍被存档使用的版本。

首版每身份最多128个资产目录、1024个任务、128个存档；配额到达返回明确错误。未发布构建也保留用于审查，占用资产配额。尚未提供在线删除/自动GC接口；维护时应停服备份，再核对所有存档依赖后处理未发布或无引用数据。不能只按创建时间清除旧版本，也不应把数据目录提交到 Git。

## 验证

```powershell
# 普通回归；真实 Docker 测试明确标为需环境的集成测试
npm run test:mcp

# PC2 已执行：包含真实隔离容器、安全、物理与服务器重新创建的恢复验收
$env:AGENTSCAPE_SANDBOX_INTEGRATION='1'
npm run check
git diff --check
```

安全测试覆盖宿主 API、环境变量、网络、非法模块、循环、内存与几何超量、非法 Manifest、取消和容器清理。恢复测试重新建立整个 HTTP Server/SessionManager，再读取磁盘资产和场景；PC2 另通过 AgentDock 验证实际部署。没有进行宿主断电、Docker内核漏洞或多进程并发存储验收。

本版不实现任意 npm、持久运行的 JS、自定义 Shader 无损迁移、Studio 当前世界实时控制、任意远程资产 URL、自动推断任意可靠关节。接入级别 Visual / Physical / Interactive 与统一 Scene API 属于下一轮接口精简，本分支保留现有引擎系统边界。

Docker 参数依据：[官方容器运行文档](https://docs.docker.com/reference/cli/docker/container/run/)。
