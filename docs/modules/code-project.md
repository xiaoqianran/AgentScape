# Code Project：自由代码世界与自定义能力

物体不再根据类别名称自动获得拿取动作；通用物理能力与新 GLB 的待审核候选参见 [语义交互与物理能力](semantic-affordances.md)。

运行完整项目模块，保留 Shader、动画、函数、闭包和持续更新；与现有“代码 → 文档 → 资产”入口并存。

## 所有权

- `application/native-scene/CodeProject.js`：模块加载、生命周期、作品保存与重开。
- `modules/world/runtime/ProjectCapabilities.js`：能力注册关系；实际对象与状态由项目持有，通过 read() 实时观察。
- `SceneFacade`：统一观察、Job、取消与写入互斥。SDK、Agent 工具和 MCP 复用同一入口。
- 项目持有原生 scene、camera、renderer；Runtime 只拥有自己的子树与物理实体。视觉对象可直接编程，物理对象通过 Runtime/物理接口操作。

## Studio 默认自动执行与可选审批策略

Studio 默认允许完整 JavaScript 项目直接运行。用户保存后点击「运行代码世界」，或者 AI 经 MCP 写入并调用 studio_project 的 run 操作，都不需要再次人工批准。

审批作为可选策略使用：可将 ProjectExecutionPolicy.js 导出的 requireProjectApproval 传入 StudioCodeProjects({ ..., executionPolicy: requireProjectApproval })，或者注入 createStudioRuntime({ ..., projectExecutionPolicy: requireProjectApproval })。只有明确启用该策略时，Studio 才显示「审阅后批准本版本」按钮，按项目 ID、修订和完整文件/资源 SHA-256 指纹进行校验；MCP 不暴露授予审批的操作。

即使默认自动执行，仍会校验 expectedRevision，启动/观察新场景后才替换原有世界；失败保留旧世界。项目保存、修订追踪、世界状态验证及任务终验也不因此失效。

**安全边界**：默认执行的代码在 Studio 浏览器同源上下文中运行，不是沙箱。请仅连接可信模型和源码；要隔离不可信代码，须由宿主应用或部署环境实现独立隔离。可选人工审批也不是 JavaScript 沙箱。

## 多文件项目

```sh
node dev/build-code-project.mjs examples/code-project/project.js public/code-projects/portal.json portal
npm run dev
```

打开 `/examples/code-project/`。构建器使用 Rolldown 将普通 ESM/npm 依赖（包括 Three.js addons）输出成**可编辑的入口 `main.js` 和按需加载的 `chunks/*.js`**；浏览器无需额外 npm 服务或打包器。`three` 不会重复打包，而是绑定当前 Studio Runtime 的同一个 THREE 实例。Shader 的 `?raw` 导入可转换为文本模块。第四个可选 CLI 参数为 resources JSON，格式 `{ "texture.png": { "mime":"image/png", "base64":"..." } }`。

需要特定构建插件、顶层 await 或不能内联依赖的项目可使用自己的构建工具输出自包含 ESM；既有复杂项目也可直接 AgentScape.attach()，保留自己的构建与循环。

```js
export function createProject({THREE,container,state,resource,signal}) {
  // 创建 scene、camera、renderer，container 是专属挂载容器。
  return {
    scene,camera,renderer,
    // 可选：colliders、navigationRoot
    setup({scene:api,world,signal}) { /* 注册能力，可异步 */ },
    update({timestamp,dt}) { /* 持续游戏逻辑、Shader 和动画 */ },
    render({timestamp,dt}) { /* 可选，自定义后处理 */ },
    serialize() { return { /* JSON 状态 */ }; },
    restore(saved) { /* 恢复显式状态，可异步 */ },
    dispose() { /* 释放 GPU 资源、监听器、renderer */ },
  };
}
```

每帧 update → Runtime → render。省略 render 时调用 renderer.render(scene,camera)。autoStart:false 时调用方推进 session.frame(timestamp)。帧异常停止自动调度，发出 project.frame.failed。

## 动态能力

```js
api.registerEntity({id:'portal',label:'传送门',object:mesh,read:()=>({uses})});
api.registerAction({
  target:'portal',name:'teleport',description:'传送到指定区域',
  parameters:{type:'object',properties:{destination:{type:'string'}},required:['destination'],additionalProperties:false},
  available:({actor})=>true, // 可选，项目自己的可用条件
  execute:async({destination},{signal,object,actor})=>{ /* 任意新行为 */ },
  verify:({before,after,args,value})=>({verified:after.uses>before.uses}), // 可选
});
const job=api.interact({action:'custom',target:'portal',name:'teleport',args:{destination:'garden'}});
const completed=await api.waitJob(job.id);
```

注册返回幂等注销函数，重名报错。参数在副作用前按 JSON Schema 检查。observe().project、inspect(id) 返回项目实时状态、动作描述、参数、可用性和验证级别。自定义实体不自动成为物理资产。

可在项目运行或动作回调中继续注册新能力。动作 timeoutMs 默认 60 秒，可单独配置，null 关闭自动取消，供长时间项目行为使用。

无 verify 的动作仍可 succeeded，verification 为 unverified，Agent outcome 为 accepted。有 verify 且返回 true 或 {verified:true} 才 verified；证据标记 project-defined，physicsVerified 始终 false。返回 false 不伪造回滚。错误/不可用为 failed，取消为 cancelled。

提供了 verify 但未通过时，执行终态仍可 succeeded，但 Agent outcome 为 unverified，不能作为已验收动作继续依赖步骤；没有验证器与已有验证器失败分别处理。

异步动作通过 AbortSignal 协作取消；主线程 API 无法强制终止任意同步无限循环。项目代码没有自动 undo/rollback 任意闭包或外部副作用的承诺。

state-equals、object-exists 验收支持项目实体。Agent 声明目标后可调用不绑定物理 actor 的 custom 动作；普通物理动作保留角色检查，任务完成依赖实时目标验证。

MCP 沿用 scene_observe、scene_interact、scene_job、scene_cancel、scene_verify、scene_save。函数在本地项目 setup 注册，不通过 JSON 传输或自动执行远端源码。

## 统一语义交互入口（首批）

Scene API 的 `inspect(target,{actor})` 与 `observe({actor})` 现在同时返回兼容的 `actions` 和统一只读 `capabilities`。
每项能力包含 `name`、`target`、`source`、`executor`、`partName`（可选）、`parameters`、`available` 与 `verification`。
能力是实时投影，不存储第二份世界状态；只有正式注册且可执行的能力才能调用。

所有来源可以统一通过 `scene.interact({action:'invoke',target,name,actor?,partName?,source?,args?})` 调用：

```js
const capabilities = scene.inspect('machine_01', {actor:'agent_01'}).capabilities;
const deploy = capabilities.find(item => item.name === 'deploy' && item.partName === 'upper_drawer');
if (deploy?.available || deploy?.canApproach) {
  const job = scene.interact({action:'invoke', target:'machine_01', name:'deploy',
    partName:'upper_drawer', actor:'agent_01'});
  const done = await scene.waitJob(job.id);
  // 只有 verification.status === 'verified' 才算通过验收
}
const job = scene.interact({action:'invoke', target:'portal', name:'teleport',
  args:{destination:'garden'}});
```

- **资产关节动作**：不再要求动作名是 `open/close`。Manifest 顶层和部件需声明同名动作、有效数值目标与真实物理关节。复用现有寻路、扫掠、关节驱动与稳定验收。多部件同名动作必须传 `partName`；旧 `open/close` 保持可用。
- **环境动作**：Environment Affordance 声明的任意名称可经过 `invoke` 执行，仍使用环境自己的前置条件、状态读取和验证。状态验证不等于物理验收。
- **代码项目动作**：已用 `registerEntity` / `registerAction` 注册的行为可通过 `invoke` 调用，复用旧 `custom` 的参数、取消和项目侧验证器。
- **可追溯性**：已验证动作写入当前 Runtime 的交互证据。没有 World IR 修订的世界使用本次运行的临时证据范围；保存重开后必须重新执行验证。
- **边界**：本阶段不自动从模型名称生成碰撞体、关节或真实抓取能力。Asset `pickup/place` 仍受 Manifest 与物理承载约束；语义推断和组合状态机在后续阶段实施。旧 `scene.interact` 形式保留。

## 作品保存

```js
const session=await AgentScape.openProject({project,container,authorized:true});
const saved=(await session.scene.save()).value;
session.close();
const reopened=await AgentScape.openProject({project:saved,container,authorized:true});
```

格式 agentscape.code-project v1：id、name、source、resources，保存时加入 state、runtime、integrity。保存模块、嵌入资源、serialize() 的 JSON 状态和 Runtime 实体/资产；期间 Scene 写入互斥，update 与 Runtime 帧暂停。重开重建行为并恢复状态，历史动作结果不充当新验证。

网络依赖、DOM、任意闭包不自动存档。省略 serialize 时自定义状态为 null，重建默认值。直接 attach 的任意项目保持原有保存边界。初始化/恢复失败清理新会话；示例先准备新会话，成功后再替换旧会话。

parseCodeProject() 不执行源码。openCodeProject() 要求 authorized:true，沿用本地受信任执行语义，无公网不可信源码隔离承诺。默认输入额度 64 MiB，可配置 maxBytes，不受资产 32 KiB 源码限制；GLB 物理准入保持原有边界。integrity 校验内容一致性，不证明作者身份。

## 验证

tests/integration/code-project.test.js 覆盖打包、模块运行、Shader、Agent 循环、参数失败、取消和作品/资产恢复。tests/browser/code-project.spec.js 覆盖真实 Chromium/HTTP MCP、动作发现与调用、页面重载恢复、持续 Shader。

2026-11-13 本地工作区验收：

| 检查 | 结果 |
| --- | --- |
| architecture:validate、typecheck、assets:validate、world:viability | 通过 |
| 全量 Vitest，maxWorkers=1 | 355 文件、1761 通过、2 跳过 |
| 最后语义修正的 code-project + skill-registry 定向回归 | 33 项通过 |
| test:mcp | 15 文件、24 通过、2 跳过 |
| test:browser | 26 项真实 Chromium 用例通过，含 HTTP MCP 和重载恢复 |
| build | 通过，保留大分块与依赖浏览器兼容性提示 |
| sdk:verify | 独立安装、跨进程恢复、代码 Worker、MCP 入口、Code Project 状态/行为/Runtime 资产恢复通过 |

默认并发的一次全量测试中，world-affordances 有 3 项超过原有 5 秒阈值；单 worker 全量通过。未放宽断言或超时，不把默认 npm run check 记录为全通过。两项跳过为未启用的 Docker 测试，未执行在线付费模型或生成服务评测。

保留了工作区已有 180 秒网关默认超时，仅同步了其过时的 90 秒测试预期。本次是本地实现与自动验收记录，不是 npm 发布或独立人类首次使用验收。

## 声明式状态机与组合行为（第三批）

通过 `scene.registerStateMachine({id,initialState,transitions,timers?,onChange?,verifyVisual?})`，Code Project 可以直接注册条件约束、原子多字段状态变化、隐藏的内部自动完成，以及对真实 Three.js 网格变换的验证。返回值的 `advance(dt)` 可用于计时。保存 Code Project 时自动加入可选的 `machines` 快照；旧的 `state`/`runtime` 不变。完成验证的项目动作仍标注 `physicsVerified:false`，不得当作 Rapier 接触力验证。

完整 API、限制、状态恢复以及**书籍翻页 + 电饭煲**示例见 [Three.js 声明式状态机](project-state-machines.md)。原生多文件可编辑工程在 `examples/code-project/semantic-workshop.json`，可直接导入 Studio。

## Studio 原生多文件工程（2026-11-13 第二批）

Studio 不再要求每次编辑都先离线打包。代码世界保持 `agentscape.code-project` v1，不修改旧项目格式的必填字段。

- `source`：入口文件源码；`entry`：入口路径（默认 `main.js`，旧项目可省略）；`files`：其余可编辑文本文件，路径到源码的映射；`resources`：图片等二进制资源原有 base64/MIME 映射。
- Studio 文件列表可创建、导入、切换、重命名、删除及保存 JS/Shader/TXT/JSON 文件；资源区导入图片等二进制文件。默认资源上传单文件上限 8 MiB；总项目由解析预算保护。
- `import './lib/util.js'`、`import code from './shaders/glow.frag'`、`import config from './settings.json'` 均可直接运行；Shader/TXT 默认导出字符串、JSON 默认导出解析后的值。来自 `three` 的标准导入与当前宿主引擎共享实例。
- 采用浏览器/Node 共用的轻量 ESM 模块链接，无须第二套服务器；**不再设定任意的 64 文件数/单文件 1 MiB 限制**。完整代码项目默认解析预算仍为 64 MiB，每个编译模块 URL 有 12 MiB 的独立预算。遇到相对导入缺失、直接模块循环或非法路径时，返回明确错误，不替换已有世界。Rolldown 构建后的标准模块循环由其预打包阶段处理。
- 直接在 Studio 编辑的相对模块现已支持**字符串字面量**形式 `import('./lazy.js')`、`import('./config.json')` 和 `import('three')`，包括项目启动之后的延迟加载。计算型动态路径（例如 `import(path)`）仍不属于直接编辑模式的能力；应改为明确的字面量分支，或使用能处理该表达式的专门构建插件。普通 Rolldown 并不保证自动转换任意计算型路径。裸 npm 包和 Three addons 路径由 `dev/build-code-project.mjs` 在本地 Node 构建时解析，**不是**浏览器运行时自动下载/npm install；直接编辑模式的未打包裸包仍会提示 `PROJECT_IMPORT_UNSUPPORTED`。Vue/React 完整网站不直接变成 Code Project，需导出遵循 `createProject(context)` 入口的 Three.js 工程或由框架宿主使用 `AgentScape.attach()`。
- 可直接从 Studio 导入 [多文件发光雕塑示例](../../examples/code-project/multifile-studio.json)；另有 [标准 Three.js/npm/动态导入示例](../../examples/code-project/standard-three/README.md)，同时能作为普通 Vite 页面运行，也可执行 `node dev/build-code-project.mjs examples/code-project/standard-three/main.js public/code-projects/standard-three.json standard_three` 后导入 Studio，验证 `three-mesh-bvh`、Shader `?raw`、延迟动作和状态恢复。

AI 工具：`readStudioProject` 返回当前项目基本信息、入口源码预览、文件/资源清单和修订号，**不会把所有资源 base64 发给模型**。`readStudioFile({path,offset,limit})` 可分页阅读文件；`editStudioFile({action,path,newPath,content,oldText,newText,expectedRevision})` 进行文件级创建/写入/补丁/重命名/删除。`editStudioResource({action,path,mime,base64,expectedRevision})` 添加/删除资源。修改不会直接影响正在运行的实例，必须重新运行。文件操作仍受修订号保护，入口文件不可删除。

MCP `studio_files` 对应操作 `file_read`、`file`、`resource`；`patch` 也可指定 `path`。完整文件仍只保存在 Studio 本机存储，不要求 MCP 客户端维护世界副本。读文件默认每页 65,536 字符，支持 `nextOffset` 分页。

## Studio 多文件事务编辑与差异审阅（第三批）

AI 不再需要按文件分别提交并承担工程处于半修改状态的风险。可通过以下流程完成多文件协同修改：

1. 使用 `readStudioProject` 获取当前修订号和文件清单，按需使用 `readStudioFile` 读取源码。
2. 发送 `previewStudioProjectBatch({expectedRevision,operations})`。每项操作指定 `kind:'file'|'resource'`、`action`、`path` 及创建内容或补丁内容；最多 32 项。系统先对一份内存草稿执行**全部**操作、检查路径、文件限制和模块引用，不运行源码，也不写入 IndexedDB。
3. 预览返回 `previewId`、受影响文件/资源列表及有界逐行差异。差异最长 3,200 字符/文件，资源只显示 MIME 与编码大小，不返回二进制 base64；Studio 左侧「待审阅多文件修改」显示增删行。
4. 通过 `applyStudioProjectBatch({previewId,expectedRevision})` 一次性发布所有改动（只调用一次底层项目保存、修订号只增加一次）。用户也可选择 `discardStudioProjectBatch({previewId})` 放弃，已有文件与运行实例保持不变。
5. 应用后如需回滚，调用 `undoStudioProjectBatch({expectedRevision})` 或点击「撤销上一批修改」。撤销恢复批次前的代码/资源，保留此后保存的运行时状态；**撤销仅限当前会话最近一次批次，后续独立编辑会清空记录**。应用和撤销后都需重新运行代码世界才生效。

MCP `studio_files` 支持 `preview_batch`、`apply_batch`、`discard_batch`、`undo_batch`，参数与 AI 工具等价。预览短期保存在当前 Studio 控制器，刷新页面会消失；存储失败不会发布部分变更，预览仍可重试。版本冲突、任何文件内容匹配失败、非法路径或缺失导入都不会覆盖草稿。多文件及资源批量导入也使用整批校验和一次保存。

这套本地控制器的 `expectedRevision` 不是跨多个浏览器标签页的数据库 CAS；跨标签并发编辑仍应避免，后续可单独升级存储并发控制。批量操作不提供任意 JS 的运行时副作用回滚，只保证草稿文件层面的原子提交。

## Studio 主工作台

世界页面点击「代码世界」，或从世界库点击「创建或打开代码世界」。左侧编辑完整 ESM，中间运行原生 Three.js，右侧显示项目对象、实时状态和动态动作。常见字符串、数字、布尔值及枚举参数自动显示输入表单；复杂参数可切换高级 JSON，动作运行时可取消，并分别显示执行结果和验证状态。

- 新建后点击「运行代码世界」；源码支持 Shader、动画、自定义逻辑和动作。
- 「保存源码草稿」持久化尚未运行的源码。「保存世界状态」保存运行源码、资源、自定义状态与 Runtime 资产。改码后先运行再保存状态。
- 本机项目存入独立 IndexedDB 数据库 agentscape-code-projects；刷新后选择、打开并运行。支持完整代码项目 JSON 导入导出。
- 重跑通过 serialize/restore 保留状态。语法或 setup 失败保留旧运行实例；任意代码产生的外部副作用无法自动回滚。
- 返回内置世界前保存当前状态，未运行源码也会保留。运行中的动作需先结束。

任务面板 AI 工具：readStudioProject 读取源码、修订号、API 指引与实时能力；writeStudioProject 创建或按 expectedRevision 写入完整草稿；patchStudioProject 使用唯一匹配的 oldText/newText/expectedRevision 精确增量修改（缺失、重复或版本冲突均不修改）；runStudioProject 运行；saveStudioProject 保存；openStudioProject 打开；closeStudioProject 保存并返回。AI 工具随活动世界刷新，与主画布共用实例。

MCP 的 studio_project 管理 read/create/create_world/open/run/save/close，studio_files 管理 write/patch/file_read/file/resource 和批量编辑。先 studio_project read，再根据文件清单用 studio_files file_read 或 file 修改，最后 studio_project run；动态动作继续通过 scene_observe、scene_interact、scene_job 执行。scene_save 同时持久化活动代码项目到本机库。此工具仅作用于连接中的 Studio，受现有 MCP 传输预算约束；大资源作品可从工作台导入。Studio 能直接编辑并运行相对依赖的 JS/Shader/JSON；第三方 npm 包仍需预打包。

此路径执行可信完整 JavaScript；AI 需要已配置的模型网关。自动验收使用固定协议响应，验证真实工具执行，不代表在线模型成功率。

2026-11-13 Studio 接入验收：Studio 测试 54 文件、238 项通过；生产构建浏览器 28 项全部通过，无跳过、重试或意外失败。覆盖 MCP 创建可见世界、手动改码、失败保护、动态动作、保存及刷新恢复，以及任务面板 AI 创建、运行、动作、修改、重跑、保存的完整流程。
## 原生网格物理绑定（mesh-bounds）

先用 `scene_query(operation=search)` 找到原生节点，再用 `scene_query(operation=physics_candidate, expectedRevision, expectedRuntimeId, expectedSceneRevision, nodePath, objectUuid)` 查询有界的组合盒候选。该操作只读，不注册碰撞体或授予动作。候选按每个可见网格的局部包围盒和真实相对变换生成定向盒，最多 64 个、20 万顶点、1024 个节点；拒绝蒙皮、实例化、Shader 变形、退化几何、剪切及非单位根缩放，不猜测质量、关节或抓取能力。

在可信 Code Project 的 `setup({scene:api})` 中使用 `api.native.bindComponent({id:'load',object:mesh,physics:{body:'dynamic',mass:1,colliders:'mesh-bounds'}})` 显式准入；固定/运动学物体可使用 `body:'fixed'/'kinematic'`。`native.analyzePhysics(object)` 是同一只读分析入口。`createProject` 返回 `walkableMesh` 或 `staticMeshes` 可把已声明的静态三角网格传入环境物理与导航；不要把同一子树再次注册为原生组件。每个物理子树保持刚性，fixed/dynamic 的变换由物理所有，kinematic 由代码所有；编辑器不能修改会导致碰撞体失真的变换，visible 不改变碰撞。重复或重叠组件被拒绝。

`scene_observe({target:'load'})` 及完整 Scene 观察返回 `physics`（注册状态、真实 body、碰撞体数量、位置、四元数、运动状态）以及独立 `stateProviders['native-physics']`。例如 `scene_verify({criteria:[{id:'body',kind:'state-equals',targetId:'load',source:'native-physics',stateKey:'body',value:'dynamic'}]})` 验证实际刚体，不等于动作/抓取证明。自定义代码动作继续通过 `registerAction` 或组件 `actions` 显式注册；真实碰撞结果由 solver 观察，项目动作证据仍为 project-defined。原生组件未进入 ObjectStore，不自动获得 pickup、place、push 等实体动作或关系图能力。物理配置随源码保存并重新注册；原生动态姿态、线速度、角速度、休眠和持有关系已纳入统一的 SceneSerializer 快照（见下节）。固定障碍的导航网格接入见原生导航小节；显式原生通用具身操作与固定基座关节见下节。

## 原生刚体通用交互与承载

原生对象仍由 EntityCapabilityRegistry 标识，刚体由 PhysicsSystem 所有，未插入 ObjectStore；通用操作使用既有 InteractionSystem、CarryRuntime、LocomotionSystem、SettleRuntime。`physics.manipulable:true` 明确启用推、拉、旋转；`physics.carryable:true` 独立启用拿取、单锚点承载、释放。动态体须声明质量；承载采用既有 15 kg、1.25 m 保守跨度、16 碰撞体限制，拒绝不支持的碰撞形状、锁定平移与非竖直碰撞旋转等配置。不因名称授予能力。

```js
api.native.bindComponent({id:'load',object:load,physics:{body:'dynamic',mass:1,colliders:'mesh-bounds',manipulable:true,carryable:true}});
api.native.bindComponent({id:'support',object:support,physics:{body:'fixed',colliders:'mesh-bounds'},
  surfaces:[{id:'top',localPosition:[0,.4,0],size:[1.1,1.1]}]});
```

固定支撑面须明确声明；当前只接受世界坐标轴对齐、水平的 fixed 刚体支撑，拒绝将运动学/动态体或旋转根当作支撑面。支持原生物体放在已声明的原生支撑面或已有 managed 资产支撑面上。通过 `scene_observe({target:'load',actor:'actor'})` 发现动作及实际 body、held、heldById 等状态；通过 `scene_interact` 的 `action:'invoke',name:'pickup'|'push'|'drag'|'rotate'|'drop',source:'native-physics',actor:'actor',target:'load'` 启动 Job，`action:'navigate',actor:'actor',position:[x,y,z]` 搬运，`action:'invoke',name:'place',source:'native-physics',actor:'actor',target:'support',args:{surfaceId:'top'}` 放置。`scene_job` 必须返回终态；支持 `scene_cancel`。已声明的项目自定义动作与原生物理动作同名时需显式指定 source。

拿取与搬运通过可达性、碰撞扫掠和锚点姿态检查；不是力学抓握，始终 `graspVerified:false`。放置只有几何支撑范围、指定支撑对象的真实求解器接触（竖直法向）及 Dynamic settle 均成立，才返回 `supportVerified:true/physicsVerified:true`。声明面不等于实际支撑。可用 `scene_verify` 的 `interaction-verified` + `source:'native-physics'` 检查 PICKUP/CARRY/DROP（目标是承载物）和 PLACE（目标是支撑对象）的历史动作收据。该收据不代表持续状态，实时 held/heldById/body 可独立验收。原生物理动作复用 Runtime 事务与统一历史；快照实际变化并记录时返回 `historyRecorded:true`，可用 `scene_history`（变更操作须提供 `requestId`）或 GUI 历史入口撤销/重做。持有原生物体期间允许保存和恢复。固定基座独立旋转/滑动关节见下节；多级串联关节、任意方向支撑面、真实抓握、原生关系图及任意场景自动地形推断及动态静态几何编辑尚未实现。

## 原生物理状态持久化与共享历史

`SceneSerializer` 将 `agentscape.native-physics-state` v1 存入快照的 `nativePhysics` 字段，与 managed `objects` 共用 CodeProject、Overlay 和历史恢复路径。最多 1024 个原生刚体（含关节部件）；固定体保存世界姿态，动态体额外保存线速度、角速度、休眠及持有者。运动学体只记录绑定身份与定义指纹，位置由原项目的 `serialize/restore` 管理。Overlay 同步采样原生与 managed 状态，再写入内容寻址块；无原生物理的世界仍走原有分页流式路径。

存档不携带可执行物理定义：必须由可信宿主/源码先重新注册相同 ID 与 SHA-256 定义指纹（碰撞体、质量、承载权限、支撑面等）。同一会话的历史快照还绑定独立注册 ID，移除后即使同名重绑也不能误用旧历史。物理世界重建时重新注册既有 Object3D 的刚体，不替换网格；先恢复 managed Agent 和既有持有关系，再恢复原生刚体与单锚点承载，校验所有权、锚点误差和碰撞。恢复失败回滚原状态和历史栈。撤销/重做和重新打开不会伪造旧动作证据；用实时 state-equals 重新验收。

CodeProject 的 setup 在 managed runtime 恢复后执行，因此初始 managed 对象创建须幂等，例如 `if(!api.actors().agents.some(a=>a.id==='actor')) await api.addModel(...)`。重新运行修改过的源码时，相同物理定义保留状态，不匹配的未持有刚体使用新源码初始状态；`nativeRestore.skipped` 明确列出不兼容/新增绑定。已持有对象的绑定不兼容时拒绝加载，不能静默丢失承载关系。历史栈不跨会话保存，任意 JS 闭包、计时器、外部副作用、物理引擎内部接触缓存/力累积并非此快照范围；这是状态级恢复而非逐帧确定性回放。旧存档无 `nativePhysics` 字段时兼容读取，保留现有宿主绑定。

## 原生关节：固定基座上的独立机械部件

在源码 `setup` 中为原始 Three.js 组显式绑定固定基座及至多 16 个独立动态部件，不需要编译或复制资产。根与部件分别声明碰撞体，不使用含有运动部件的整组 mesh-bounds。每个部件使用唯一 `node` 名称，必须为基座直接子节点，单位缩放、装配时旋转为单位四元数。关节轴为基座局部轴，`limits` 必须含零（旋转单位 rad，范围严格小于 ±π；滑动单位 m，最大 ±10）；`parentAnchor` 默认由装配位置和 `childAnchor` 推导，显式锚点不一致则拒绝。移动部件须明确质量和碰撞体，不自动推断门铰链、滑轨或可抓取性。

```js
api.native.bindComponent({id:'machine',object:machine,
  physics:{body:'fixed',colliders:[{shape:'box',halfExtents:[.2,.4,.2]}]},
  parts:{door:{node:'DoorPivot',physics:{body:'dynamic',mass:1,
    colliders:[{shape:'box',halfExtents:[.3,.4,.04],translation:[.3,0,0]}]},
    joint:{type:'revolute',axis:[0,1,0],limits:[0,1.5],motor:{stiffness:80,damping:12}}}}});
```

`scene_observe({target:'machine',actor:'actor'})` 返回 `physics.joints` 与分部件的 `rotateJoint` / `slide` capability。`scene_interact` 使用唯一 `requestId` 和 `interaction:{action:'invoke',target:'machine',actor:'actor',name:'rotateJoint',partName:'door',source:'native-physics',args:{target:1.0}}`；滑动对应 `slide`，相对量用 `distance`，旋转相对量用 `angle`。实际部件碰撞体可达性、关节限位、运动稳定性由原有求解器执行器检查；遮挡、碰撞或阻塞不能返回已验证。`scene_verify` 的 `interaction-verified` criterion 可带 `partName`，例如 `capability:'ROTATEJOINT',partName:'door',source:'native-physics'`。各部件凭证独立；没有 partName 时是该实体该能力最近一次成功凭证，并非所有部件都验证。历史恢复清理旧凭证。

状态保存记录各部件 solver 世界位姿、速度、休眠、马达目标，恢复前校验锚点、关节限位及定义指纹。重建从源码注册时的零位创建物理关节，再恢复当前状态，不替换宿主 Object3D。多级串联机械臂暂时明确拒绝（实测耦合马达在增加迭代后仍有约 0.11 rad 误差，超出既有 0.08 rad 验收容差）；不调整全局求解器参数，不宣称多关节协调控制或真实抓握。GUI 尚未补齐分部件动作控件。

## 原生世界导航：同源碰撞几何

CodeProject 返回 `staticMeshes:[roomGroup,stairsGroup]` 或 `walkableMesh:floor` 时，递归读取显式静态 Mesh/Group 子树，冻结世界空间三角形，同一组几何同时供 Rapier 环境碰撞与 Recast 导航构建。也可仅返回显式 `colliders`（box/trimesh 精确三角化，圆柱/胶囊曲面为离散近似，凸包三角化），不需要独立可视化代理。原来的 `navigationRoot` 仍为显式自定义导航代理，使用者负责其与碰撞的一致性；默认使用物理几何，`navigationSource:'physics-colliders'`。

`native.bindComponent` 注册的固定刚体根碰撞体纳入静态导航输入（不会误收动态关节部件的初始网格），注册/移除/历史恢复令导航重建。动态、运动学及关节部件继续通过真实 solver collider descriptor 在查询时更新 Recast tile cache；动作成功不等于路可通，实际路径和角色控制器仍需检验。移动中出现新障碍由 KCC 与承载碰撞检查拦截，不宣称每帧全量重规划。`scene_interact` navigate 的实际到达验证同时检查高度，不把楼上与楼下的相同 XZ 判为到达。

静态根不得包含动态标记、重复/重叠子树、蒙皮/实例化等未支持网格；最多 32 个静态环境 Mesh、10 万环境三角形、20 万环境顶点，镜像变换修正绕序。Native 导航构建保护为最多 2048 个碰撞输入、20 万三角形、40 万顶点、水平范围各 256 m；越界明确失败，不截断成看似可通行的地图。静态几何在 attach 时冻结；若需修改建筑，修改源码并重新运行。任意运行时场景自动扫描、超大场景分块流式导航、自动开门规划、真实机器人抓握与专用 GUI 控件未实现。现有动态障碍表示仍受 Recast tile cache 容量与保守几何近似限制。

## Studio 统一原生物理交互面板

代码世界右侧对象检查器通过 `SceneFacade.observe/inspect` 发现托管资产、原生物理绑定、项目实体及可编辑对象。左侧可视化列表与右侧使用同一稳定对象 ID；绑定刚体可选中并查看，未声明可编辑属性时不生成变换手柄，不允许以直接拖拽冒充物理交互。选中物体以 500ms 间隔读取实时状态；场景列表按注册、历史及动作事件刷新，不逐帧遍历全部能力。Agent 选择调用 `SceneFacade.selectActor`，物理表单复用普通 Inspector 的 `AffordanceActionPanel`，以 `action:invoke`、明确 `source`、`partName` 和参数通过 `EditorCommandQueue` 提交同一 Scene Job。项目自定义动作仍保留其 JSON Schema 表单。原生/托管持有者与支撑面可交叉发现，实际放置仍由接触及稳定性验收决定。

`SceneFacade.previewNavigation({actor,position})` 是只读查询（不移动、不写历史、不改变 Scene revision），GUI 显示实际 Recast 路径俯视图、长度、高度与不可达原因；它是查询时刻快照，开始导航时重新查询并使用角色物理控制器。物理任务取消请求发送到真实 Job ID，不报告为已验证。每个运行会话只有一个 GUI 命令队列，关闭/重开检查器不丢失动作结果；恢复 Scene 后清理既有已完成动作提示，不把历史回放当成当前验证。Undo/Redo 使用与 MCP 相同的 `scene.history`。GUI 不提供新的物理引擎、自动关节推断或实时全局路线保证。

## 自主任务：原生关节导航诊断与跨楼层取物

`scene_navigation({actor,position})`（SDK `scene.diagnoseNavigation`、Agent Skill `diagnoseSceneNavigation`）读取当前物理 Agent 位置并查询真实 Recast 路线。仅在不可达/部分路径时，从当前 TileCache 障碍物的 objectId/partName provenance 识别候选；最多 6 组（底层可配置 1–8），每个显式原生 revolute/prismatic 关节最多尝试两个合法限位端点，跳过已在当前位置附近的目标。以同一份求解器碰撞体投影构建假设姿态，临时替换对应导航障碍、同步并查询，再恢复实际障碍；不移动 Rapier 刚体、不写历史。假设路线可达仍须通过有界外部碰撞采样检查，以及 Actor 具身能力发现（available/canApproach）。反事实失败时恢复实际障碍；无法恢复则使导航网格失效并拒绝推荐。托管 open 候选保留旧的 obstacle-suppressed 诊断语义，不与原生 joint-target-pose 混淆。

原生推荐包含明确 `source:'native-physics'`、`target`、`partName`、`name:'slide'|'rotateJoint'`、合法 `args.target` 与 actor。限位端点不是自动推断的开/关标签；建议仅是 provisional。Agent 在不可变任务目标内选择有依据的动作，经 `interactScene({goalId,interaction})` 或 MCP `scene_interact` 完成实际动作和验证；重新 `diagnoseSceneNavigation` / `scene_navigation` 确认当前路线，然后真实导航。不允许以反事实结果证明动作成功。已有 Agent 步数、重复失败及任务验收机制仍然生效。跨楼层接近点优先当前高度，失败后尝试由目标下界推导的有界高度候选；每个候选仍需实际路径和视线检查。`relation-exists` 的 native/mixed ON（或反向 SUPPORTS）使用当前支撑几何、具名向下实际 solver contact、未持有及速度阈值，不复用历史放置 receipt；任意其他 native 空间关系仍不凭空推断。

验证范围：已用确定性 gateway 驱动实际 Agent 循环完成不同 ID 和镜像布局的失败导航、关节恢复、重新寻路、上楼取物、下楼放置及当前验收。反事实预测不等于真实运动保证；同一装配内部碰撞、连续动态变化、路径和手持物的全过程安全仍由实际求解器与动作验收决定。目前只尝试单关节限位端点，不搜索任意连续参数或多关节组合，不自动操作用户未授权的对象；在线 LLM/VLM 自主规划质量及所有浏览器场景未在本轮完整验证。

### 串联原生障碍的阶段性恢复

当单一原生关节的假设目标姿态无法直接连通最终目的地时，`scene_navigation` 可以返回 `partial-route-progress`。仅在真实和假设路线均为 `PARTIAL_PATH`、起终点吸附位置分别保持在 0.1 m 以内、假设路径末端向相同目标的三维剩余距离及末端位移均至少达到 `max(0.5, 2 * agentRadius, 2 * endTolerance)` 米时，才承认为有意义的阶段性进展。候选仍须通过原有关节限位、障碍物替换与恢复、运动包络碰撞采样；SceneFacade 对可推荐的原生候选复用实际关节操作的瞄准点和接近点规划做只读 preflight，拒绝没有操作点的候选。`counterfactual.reachable` 仍为 false，`recommendation.progress` 说明预测收益；完整连通候选优先于阶段性候选。每个恢复动作必须单独执行、验证并重新诊断；禁止把预测结果当作实际到达或直接执行整个假设动作序列。旧托管 open 诊断保持原有单步完整连通语义。当前不搜索多关节联合状态，不保证跨任意拓扑的最优动作序列或连续碰撞安全。

本轮通过真实 HTTP MCP、独立 Studio 浏览器和原生物理双升降隔断走廊复现故障；修复后逐次读取实际诊断，分别完成两个关节动作，取货并返回约 10.82 m 完成放置。最终同运行帧验收 4/4：ON 支撑接触、已释放、两个 SLIDE 凭证，另返回视觉 JPEG。自动回归覆盖双镜像布局和首道障碍扫掠碰撞拒绝。
