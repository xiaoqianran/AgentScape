# v0.1 验证记录

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
