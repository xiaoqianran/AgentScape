# AgentScape 项目资产与全局资产（2026-11-14）

## 双层存储

**项目资产（Project editable）**

- 通过 scene_add_model 添加 three-code、mechanical-draft 或 asset-recipe，Object Forge 记录与单个实例绑定的源定义、revision 和可选的 originAssetId。
- scene_save 导出的 agentscape.project-bundle 新增可选 editable 字段：对象 ID、源定义、修订版和来源全局版本，参与 lock.content 哈希校验。
- scene_import 通过隔离校验，恢复世界后重建编辑来源；旧版不含 editable 的场景包仍能导入，只是无法凭空恢复不存在的编辑源代码。
- 单实例字段修改编译为新本地 asset_ 版本，其他实例不受影响；物理准入失败保留旧实例和修订版。
- scene_save 是自包含可移植包。包含已发布 pa_ 全局资源时，导出复制编译资源并转换为私有 asset_ 依赖；导入绝不覆盖不可变的 pa_ 全局版本。

**全局资产（Owner-global immutable）**

- 全局指当前 MCP 用户身份范围的个人资产库，而非其他账号公开可见的资产市场。
- asset_publish_project(worldSessionId, objectId, requestId) 仅显式发布当前私有 MCP 会话中准入为 ready 的 Object Forge 资产。
- 创建不可变 pa_ 内容寻址版本；保存 source.json、asset.glb、manifest.json、build.json、published.json，并对每个部分执行哈希校验。
- asset_list 和 asset_inspect 既可列出程序化构建资产，也可列出项目发布资产；其他用户无权访问。
- 在新项目通过 scene_add_model 加载指定的 asset://sha256/<digest>。新版本不会自动覆盖之前版本，旧世界锁定先前依赖。
- world_save/world_restore 保存已发布资产的精确依赖，因而可以跨进程恢复，而不需携带自定义编译资产副本。

## 从全局资产创建项目独立分支

1. 在私有项目中用 scene_add_model 引用 owner-global 版本。
2. 使用 scene_object_definition，operation=fork，提供 worldSessionId、objectId 和新的 requestId。
3. 系统确认当前对象确实引用属于当前身份的已发布 Project Asset，恢复原始编辑声明，记录 originAssetId。全局不可变版本完全不变。
4. 通过 inspect、preview、apply 对部件按名称进行定点修改。例如 /parts/@seat/geometry/size。得到新的本地 asset_ 版本。
5. 如确需跨项目复用新版本，再调用 asset_publish_project 显式发布，旧全局版本继续可用。

示例请求：

    {"worldSessionId":"私有世界 UUID","objectId":"global_chair","operation":"fork","requestId":"请求 UUID"}

然后可预览：

    {"worldSessionId":"私有世界 UUID","objectId":"global_chair","operation":"preview","expectedRevision":1,"requestId":"请求 UUID","changes":[{"path":"/parts/@seat/geometry/size","value":[1.2,0.2,1]}]}

拿到 previewId 后以 operation=apply、expectedRevision=1、previewId 和新 requestId 提交。

## 安全与能力边界

- 资产编译准入 ready 不等于动作在当前世界已经被验证；实际后置动作验证仍通过 scene_interact、scene_job、scene_verify 完成。
- scene_save 的便携副本转换为本地资产 ID，而 world_save 保留 owner-global 不可变版本引用。不能将两者混为同一持久化操作。
- 当前 asset_publish_project 只面向私有 MCP Session；Studio 可以通过 scene_save 保存可编辑源定义，但浏览器端资产直接发布到全局库的授权桥尚未实现。
- fork 只支持来源于本功能的 owner-global Project Asset，不反向构造第三方 GLB、只读内置对象或其他程序化构建资产的原始可编辑定义。
- 不提供跨用户公开市场、自动 latest 升级、删除已发布依赖或大规模资产权限转让；这些属于后续扩展。
- 仍受 MCP 单请求大小上限与源声明校验约束，大型世界应使用分块世界包存储。

## 回归验证

- tests/mcp/project-asset-lifecycle.test.js：项目源声明跨服务重启继续修正、版本升级互不影响、owner 隔离、Fork、便携副本与篡改检测。
- tests/mcp/project-global-articulation.test.js：真实机械关节发布，跨会话调用 open，world_save/world_restore 锁定原版本。
- tests/studio/studio-object-forge.test.js：Studio 侧 scene_save 含可编辑定义和 revision。

架构继续复用 ScenePackage、FileAssetRepository、SceneObjectForge、ArticulationVerifier 和 WorldRuntime，没有引入平行物理引擎或依赖某个特定 LLM。
