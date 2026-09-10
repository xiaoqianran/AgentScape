# Repository Layout

当前采用 apps + application + modules + foundation。模块内部沿用实际代码结构，不预建 execution/context/adapters 等统一模板。

```text
apps/          studio、observatory、server 等运行入口
application/   模块装配、Skills、Agent 观察、跨域生成流程
modules/       agent、generation、artifact、asset、world、rendering
foundation/    事件、追踪、HTTP、权限匹配等小型基础机制
services/      独立进程：Python asset-compiler
sdk/           对外分发的客户端
dev/           开发脚本、实验、验证、planning-ui
planning/      跨模块任务与任务格式约定
tests/         现有按能力组织的测试
docs/          项目说明与历史设计
public/        静态资源
api/           部署平台需要的薄 HTTP 入口
```

## 依赖与所有权

- apps 使用 application 和模块；modules 不导入 application、apps、dev。
- application 负责跨域协调，不保存第二份世界或资产状态。
- foundation 不导入上层。领域错误在各领域，基础错误类型保留在 foundation。
- Asset 发布与 Artifact 存储保持原有唯一构造边界；World 只使用限定的 Asset 契约。
- Observatory 可以检查产品内部，产品不能依赖 Observatory；实验性 WebGPU probes 属于 Observatory。
- Node 服务实现放 apps/server，根 api 仅转发。浏览器产品不能导入服务端实现。
- 源文件与公开路由分离：Studio 仍在 /，Observatory 仍在 /observatory/。

## 当前入口

- Studio：apps/studio/main.js
- 产品装配：application/createSession.js
- Agent 循环：modules/agent/ToolCallingAgent.js
- Skills：application/skills/registerCoreSkills.js
- 跨域生成：application/generation/GenerationRuntime.js
- 生成任务与 Connector：modules/generation/
- 资产与产物：modules/asset/AssetModule.js、modules/artifact/ArtifactModule.js
- 世界：modules/world/runtime/WorldRuntime.js
- 模型代理：apps/server/openai-compatible-agent-gateway.mjs

application/generation 保留已有三份协调实现，避免在迁移中重新拆解算法。GenerationRuntime 虽然沿用类名，现已明确属于 application，而非生成任务模块。

## 模块工作方式

主要所有者就近维护 README.md 和 tasks.jsonl。README 说明职责、入口、限制及验证方式；任务状态只记录在 JSONL。不要求每个子目录都有文档或任务文件，不要求每个模块独立 package 或 CI。

运行 npm run planning:list 聚合任务，npm run planning:ready 读取可执行队列。任务不复制到根文件；详见 ../planning/README.md。

## 本次迁移的范围与保留限制

已完成目录迁移、引用更新、模块任务分发、Studio 装配入口提取、领域错误归位和分层检查。
未将目录调整混同为全部运行时解耦：world.generation/world.skills 仍是现有兼容连接；WorldRuntime 仍组装 RenderingSystem；SkillRegistry 仍负责既有结果分类；PolicyEngine 暂保留默认产品角色。
这些限制应按实际任务逐步改进，不能把当前目录结构当作它们已解决的证据。

验证继续复用 npm run check，不为每个模块建立单独框架。
