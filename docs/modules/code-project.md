# Code Project：自由代码世界与自定义能力

运行完整项目模块，保留 Shader、动画、函数、闭包和持续更新；与现有“代码 → 文档 → 资产”入口并存。

## 所有权

- `application/native-scene/CodeProject.js`：模块加载、生命周期、作品保存与重开。
- `modules/world/runtime/ProjectCapabilities.js`：能力注册关系；实际对象与状态由项目持有，通过 read() 实时观察。
- `SceneFacade`：统一观察、Job、取消与写入互斥。SDK、Agent 工具和 MCP 复用同一入口。
- 项目持有原生 scene、camera、renderer；Runtime 只拥有自己的子树与物理实体。视觉对象可直接编程，物理对象通过 Runtime/物理接口操作。

## 多文件项目

```sh
node dev/build-code-project.mjs examples/code-project/project.js public/code-projects/portal.json portal
npm run dev
```

打开 `/examples/code-project/`。构建器将普通多文件 JS 和可打包 npm 依赖合并为自包含 ESM，import 'three' 绑定宿主的同一实例，addons 可正常解析。第四个可选 CLI 参数为 resources JSON，格式 `{ "texture.png": { "mime":"image/png", "base64":"..." } }`。

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

## Studio 原生多文件工程（2026-11-13 第二批）

Studio 不再要求每次编辑都先离线打包。代码世界保持 `agentscape.code-project` v1，不修改旧项目格式的必填字段。

- `source`：入口文件源码；`entry`：入口路径（默认 `main.js`，旧项目可省略）；`files`：其余可编辑文本文件，路径到源码的映射；`resources`：图片等二进制资源原有 base64/MIME 映射。
- Studio 文件列表可创建、导入、切换、重命名、删除及保存 JS/Shader/TXT/JSON 文件；资源区导入图片等二进制文件。默认资源上传单文件上限 8 MiB；总项目由解析预算保护。
- `import './lib/util.js'`、`import code from './shaders/glow.frag'`、`import config from './settings.json'` 均可直接运行；Shader/TXT 默认导出字符串、JSON 默认导出解析后的值。来自 `three` 的标准导入与当前宿主引擎共享实例。
- 采用浏览器/Node 共用的轻量 ESM 模块链接，不需要另一套服务器；每个代码文件最大 1 MiB，工程最多 64 个文本文件，编译后的模块 URL 有独立预算。遇到相对导入缺失、循环引用或非法文件名，返回明确错误且不会替换现有世界。
- 当前**不支持**动态 `import()`、npm 裸包（除 `three`）、Three addons 路径及自动转换 Vue/React 工程。这些工程继续通过 `dev/build-code-project.mjs` 预打包；原生框架宿主可继续使用 `AgentScape.attach()`。
- 可直接从 Studio 导入 [多文件发光雕塑示例](../../examples/code-project/multifile-studio.json)，真实 ShaderMaterial、动态 `setSpeed` 和保存恢复可共同测试。

AI 工具：`readStudioProject` 返回当前项目基本信息、入口源码预览、文件/资源清单和修订号，**不会把所有资源 base64 发给模型**。`readStudioFile({path,offset,limit})` 可分页阅读文件；`editStudioFile({action,path,newPath,content,oldText,newText,expectedRevision})` 进行文件级创建/写入/补丁/重命名/删除。`editStudioResource({action,path,mime,base64,expectedRevision})` 添加/删除资源。修改不会直接影响正在运行的实例，必须重新运行。文件操作仍受修订号保护，入口文件不可删除。

MCP `studio_project` 对应新增操作 `file_read`、`file`、`resource`；`patch` 也可指定 `path`。完整文件仍只保存在 Studio 本机存储，不要求 MCP 客户端维护世界副本。读文件默认每页 65,536 字符，支持 `nextOffset` 分页。

## Studio 多文件事务编辑与差异审阅（第三批）

AI 不再需要按文件分别提交并承担工程处于半修改状态的风险。可通过以下流程完成多文件协同修改：

1. 使用 `readStudioProject` 获取当前修订号和文件清单，按需使用 `readStudioFile` 读取源码。
2. 发送 `previewStudioProjectBatch({expectedRevision,operations})`。每项操作指定 `kind:'file'|'resource'`、`action`、`path` 及创建内容或补丁内容；最多 32 项。系统先对一份内存草稿执行**全部**操作、检查路径、文件限制和模块引用，不运行源码，也不写入 IndexedDB。
3. 预览返回 `previewId`、受影响文件/资源列表及有界逐行差异。差异最长 3,200 字符/文件，资源只显示 MIME 与编码大小，不返回二进制 base64；Studio 左侧「待审阅多文件修改」显示增删行。
4. 通过 `applyStudioProjectBatch({previewId,expectedRevision})` 一次性发布所有改动（只调用一次底层项目保存、修订号只增加一次）。用户也可选择 `discardStudioProjectBatch({previewId})` 放弃，已有文件与运行实例保持不变。
5. 应用后如需回滚，调用 `undoStudioProjectBatch({expectedRevision})` 或点击「撤销上一批修改」。撤销恢复批次前的代码/资源，保留此后保存的运行时状态；**撤销仅限当前会话最近一次批次，后续独立编辑会清空记录**。应用和撤销后都需重新运行代码世界才生效。

MCP `studio_project` 新增 `preview_batch`、`apply_batch`、`discard_batch`、`undo_batch`，参数与 AI 工具等价。预览短期保存在当前 Studio 控制器，刷新页面会消失；存储失败不会发布部分变更，预览仍可重试。版本冲突、任何文件内容匹配失败、非法路径或缺失导入都不会覆盖草稿。多文件及资源批量导入也使用整批校验和一次保存。

这套本地控制器的 `expectedRevision` 不是跨多个浏览器标签页的数据库 CAS；跨标签并发编辑仍应避免，后续可单独升级存储并发控制。批量操作不提供任意 JS 的运行时副作用回滚，只保证草稿文件层面的原子提交。

## Studio 主工作台

世界页面点击「代码世界」，或从世界库点击「创建或打开代码世界」。左侧编辑完整 ESM，中间运行原生 Three.js，右侧显示项目对象、实时状态和动态动作。常见字符串、数字、布尔值及枚举参数自动显示输入表单；复杂参数可切换高级 JSON，动作运行时可取消，并分别显示执行结果和验证状态。

- 新建后点击「运行代码世界」；源码支持 Shader、动画、自定义逻辑和动作。
- 「保存源码草稿」持久化尚未运行的源码。「保存世界状态」保存运行源码、资源、自定义状态与 Runtime 资产。改码后先运行再保存状态。
- 本机项目存入独立 IndexedDB 数据库 agentscape-code-projects；刷新后选择、打开并运行。支持完整代码项目 JSON 导入导出。
- 重跑通过 serialize/restore 保留状态。语法或 setup 失败保留旧运行实例；任意代码产生的外部副作用无法自动回滚。
- 返回内置世界前保存当前状态，未运行源码也会保留。运行中的动作需先结束。

任务面板 AI 工具：readStudioProject 读取源码、修订号、API 指引与实时能力；writeStudioProject 创建或按 expectedRevision 写入完整草稿；patchStudioProject 使用唯一匹配的 oldText/newText/expectedRevision 精确增量修改（缺失、重复或版本冲突均不修改）；runStudioProject 运行；saveStudioProject 保存；openStudioProject 打开；closeStudioProject 保存并返回。AI 工具随活动世界刷新，与主画布共用实例。

MCP 的 studio_project 支持 read/write/patch/file_read/file/resource/run/save/open/close。先 read，再根据文件清单选择 file_read 和 file 修改，最后 run；动态动作继续通过 scene_observe、scene_interact、scene_job 执行。scene_save 同时持久化活动代码项目到本机库。此工具仅作用于连接中的 Studio，受现有 MCP 传输预算约束；大资源作品可从工作台导入。Studio 能直接编辑并运行相对依赖的 JS/Shader/JSON；第三方 npm 包仍需预打包。

此路径执行可信完整 JavaScript；AI 需要已配置的模型网关。自动验收使用固定协议响应，验证真实工具执行，不代表在线模型成功率。

2026-11-13 Studio 接入验收：Studio 测试 54 文件、238 项通过；生产构建浏览器 28 项全部通过，无跳过、重试或意外失败。覆盖 MCP 创建可见世界、手动改码、失败保护、动态动作、保存及刷新恢复，以及任务面板 AI 创建、运行、动作、修改、重跑、保存的完整流程。