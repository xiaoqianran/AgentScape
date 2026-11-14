# Object Forge：结构分析、AI 声明与定点修正（阶段一）

本功能复用 AgentScape 的 Scene API、AssetModule、ArticulationVerifier 和 Runtime 事务，不创建第二套物理引擎，也不调用 LLM。

## 工作方式

1. 纯代码分析：从当前实例真正存在的 Three.js Object3D 读取节点、父子结构、局部位置和已有几何边界，最多 128 节点。
2. AI 声明：通过 scene_add_model 导入 mechanical-draft、asset-recipe 或 three-code 后，保留单个对象的原始结构化定义与 revision。
3. 融合：scene_object_definition(inspect) 同时返回 definition（AI 声明）、analysis.declared（结构化声明）、analysis.observed（实际场景节点）和 analysis.reconciliation（节点名匹配及缺失）。声明的关节仅为候选，不能冒充已验证动作。
4. 修正：scene_object_definition(preview) 检查指定字段及 Schema，返回 previewId，不运行物理验证；scene_object_definition(apply) 编译新资产、执行物理准入，然后通过 SceneFacade.replaceAsset 只替换指定实例。成功后 revision+1，失败保持原对象及原定义 revision。

## MCP 参数

新增 scene_object_definition；私有世界传 worldSessionId，自动连接 Studio 时可省略。写入操作必须传 requestId。

检查定义：
    {"operation":"inspect","objectId":"classroom_door_01"}

预览修正：
    {"operation":"preview","objectId":"classroom_door_01","expectedRevision":1,"requestId":"<uuid>","changes":[{"path":"/components/@Panel/color","value":"#dd8844"}]}

应用修正：
    {"operation":"apply","objectId":"classroom_door_01","expectedRevision":1,"previewId":"<preview-uuid>","requestId":"<uuid>"}

支持已有字段的 replace；路径根只能是 /components、/motions、/parts、/definition。数组既可使用数字下标，也可通过 @ 加部件 ID 定位，例如 /components/@Frame/size、/motions/@door/open、/parts/@body/geometry/size、/definition/physics/mass。每次最多 8 项，变更数据上限 32 KiB；拒绝原型链、越界和不存在的字段。

## 必须遵守的证据边界

- 观察到的 Three.js Group 不是物理关节。几何结构分析不自动发放 open、pickup 等权限。
- preview 不执行编译或物理测试，验证等级为 not-run。apply 返回 compiled-and-admitted，指编译与正式准入，不代表 Agent 已真实执行动作；后置验证仍调用 scene_interact、scene_job 和 scene_verify。
- 三维代码资产的补丁仅能修正已有 definition 字段，不能通过该接口执行新 JS 代码。完整源码变动使用 studio_project 或原有受控资产构建入口。
- 私有 MCP 会话现在向 SceneFacade 传入已有 worker-wasm 安全执行器。显式禁用代码执行时仍返回 CODE_EXECUTION_DISABLED。
- 同一资产的其他实例不会自动改变。替换当前实例可能重置关节/物理状态，动作仍需重新验证。
- **当前限制：可编辑原始定义仅保存在当前私有会话/Studio Bridge 的内存中。** scene_save/scene_import 恢复对象、资源和世界状态，但不会恢复可编辑定义；跨会话继续定点编辑需要重新提供源声明。
- 对已经存在的第三方 GLB、内置资产、只读已发布资产，不反推不存在的原始可编辑代码。
- 原实例替换由 Runtime 事务保护，失败不修改原对象及其定义 revision；失败中产生的编译缓存可暂留会话内，不应被当成已发布版本。

## 测试

- tests/mcp/object-definition.test.js：机械门定点改色、具名部件、revision 冲突、失败物理编译回滚、另一实例不受影响。
- tests/mcp/object-three-code.test.js：真正执行 Three.js createAsset(THREE)，再定点改变质量，另一实例不受影响。
- tests/studio/studio-object-forge.test.js：Studio Bridge 同样能够 inspect、preview、apply。
- tests/world/world-collision-signature.test.js：材质/质量变更允许复用同一碰撞空间，碰撞体或关节变化仍重新检查。

## 下一阶段

将可编辑对象定义及其版本历史随世界包和 Studio Code Project 持久化，增加 GLB 部件原始来源绑定，并利用现有 KinematicEvidencePass、KinematicHypothesisScreen 自动生成更丰富的候选动作，仍以 Runtime 验证为最终事实。
