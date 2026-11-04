# 验证记录

## v0.2 程序化创作

2026-11-04：当前 `feat/ui-design-system-unify` 分支。增加隔离创作、草稿查询、准备、晋升、显式更新、验证、源码导出七个 MCP 工具，共十六工具；复用既有应用层创作晋升链，增加 Node 嵌入纹理加载和盒状物体搬运。

- `npm run check`：架构、Planning、资产、世界可用性、类型检查、314测试文件/1592项测试、构建通过；最终边界检查补充后 MCP 六文件/七测试再次通过。
- 隔离执行测试：循环中断、超内存分配拒绝、Node/网络不可用、回调和 Shader 拒绝、旧草稿不被失败覆盖、数据纹理保留、原始几何参数和过大绘制分组被拒绝。
- HTTP 工作流：真实编译新纹理盒状物体，默认拒绝 provisional 晋升；显式编辑态晋升后真实 pickup/place 均 verified；自定义存在、拾取和桌面支撑验收通过；源码导出保持一个成功版本，重试不重复执行，失败不进入版本记录。
- 物理回归：盒状物体路径遇墙阻挡，带局部旋转的盒状碰撞体正确检查终点占用；原圆柱/胶囊搬运、放置与 Studio 创作测试通过。
- PC2 AgentDock 已 refresh 为 ready/16工具。独立真实会话提交带2×2纹理的 Three.js 方块，晋升后 pickup=held/verified、place=placed/verified，自定义三项验收通过、最终空手。源码导出成功并关闭会话。
- PC2 完整调用记录位于私有运行目录 `C:\Users\yuminghui\.agentdock\agentscape-world\authoring-acceptance.json`。这份记录不含认证凭据，不随 Git 发布。

本阶段不宣称完整项目导入、服务重启后恢复、Studio 实时同步、截图或任意动画/Shader 的无损接入。资产 provisional 状态未被动作成功提升；详见 AUTHORING.md。

## v0.1 历史基线

基线：1ebb6b5，独立分支 feat/agentscape-remote-mcp。环境：Windows、Node.js v24.18.0、npm 12.2.0。

- `npm ci --ignore-scripts --no-audit --no-fund`：独立检出安装通过。
- `npm run world:viability`：现有真实物理、导航和具身任务通过。
- `npm run check`：架构、Planning、资产、世界可用性、TypeScript、311个测试文件/1588个测试及生产构建通过。仍有原有大分块提示。
- 最后一次 SessionManager 关闭状态保护修改后，`npm run test:mcp` 再次通过：3文件/4测试。
- `git diff --check`：通过。
- 原目录 Git HEAD 保持 1ebb6b5，tracked/untracked 状态输出为空。未读取 .env.local 或密钥，未启动原目录服务。

官方 MCP Client 使用 Streamable HTTP，发现9工具；Alice/Bob 两身份创建独立世界。依次 action-completed / held / placed，均由 Runtime 分类 verified；最终 world-accepted、Agent carry=empty。导出9140字节 JSON。完整逐项证据在 acceptance-evidence.json。

测试覆盖详情见 README。安全测试和真实动作使用同一正式 Runtime 装配。未运行付费生成、外部模型推理或部署；未验证具体托管 Agent 产品接入，也未重新进行 Studio 浏览器交互验收。Studio/Observatory 回归依据既有自动测试与生产构建；未修改其源码。

崩溃测试边界：覆盖残留损坏临时文件与旧会话目录不会自动加载，尚未通过强制杀进程验证所有操作系统崩溃/断电情形。每会话使用有界对象/动作预算，未实现 OS 级硬内存隔离。私有 TLS 代理部署需由使用者配置；本次不发布公网服务。
