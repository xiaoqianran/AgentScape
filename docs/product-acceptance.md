# 产品闭环验收交接

## 已固定的基线

2026-11-02 从 `992128e` 的未提交工作区审阅、按职责拆分保存：

- `39fd555`：世界写入互斥、规则事务、物理检查点、恢复和回滚修复。
- `924dcca`：中文 Studio 工作台、真实资源预览、编辑器与错误反馈。

两批内容来自交接前已有工作区；未丢弃或覆盖已有修改。后续产品验收以 `924dcca` 为起点，不以 `992128e` 或归档 roadmap 为起点。

## 复现

CI 使用 Node.js 22；本次本机为 Windows / Node.js 24.18.0 / npm 12.2.0。安装使用锁文件：

```sh
npm ci
npm run check
npm run dev
```

打开 Vite 输出的本地地址。无私有配置时，内置世界、资源、物理交互、编辑和浏览器本地存档可用；自然语言任务需要服务器侧模型服务，远端生成需要 Connector 配对和对应服务。未配置不能作为任务成功证据。

`npm run check` 包括架构、资产、真实 world viability、TypeScript、默认 Vitest 和生产构建。基线本机结果为 305 个测试文件、1567 个测试通过；生产构建通过，仍有大分块警告。该结果不包含浏览器用户流程、真实模型或真实生成验收。

独立检出复现：

```sh
git worktree add --detach ../AgentScape-baseline-acceptance 924dcca
cd ../AgentScape-baseline-acceptance
npm ci
npm run check
```

独立目录不能复制 `.env.local`、浏览器配置或 `node_modules`。验收日志存放在目录内的 `baseline-install.log` / `baseline-check.log`（不提交机器日志）。

## 单独入口与证据边界

| 入口 | 证明范围与依赖 |
| --- | --- |
| `npm run world:viability` | 真实 WorldRuntime、Rapier、Recast、柜内杯子到桌面、存档恢复；无在线 LLM |
| `npm run test:agent` | 工具选择及执行纪律回归；包含脚本 gateway，不能当真实模型成功率 |
| `npm run agent:gateway` | 本地模型网关，配置参见 `.env.local.example`；凭据仅置于服务器侧 |
| `npm run agent:probe` | 在线工具选择探针，部分工具结果模拟；运行前需调用预算授权 |
| `npm run test:modal-e2e` | 真实本地 Python Connector + 固定 GLB 协议测试；需要 `uv` 和同级 `modal-provider/modal-gen-client`，不调用付费生成 |
| `node dev/experiments/world/003-cross-world-open-pickup-place.mjs` | 三环境布局实验；历史注释不是本轮结果 |
| `node dev/experiments/world/004-cross-world-cabin-layout-recovery.mjs` / `005-cabin-door-reachability.mjs` | 布局／可达性实验，须记录新运行结果 |

默认 `npm test` 明确排除 `tests/e2e/generated-cup-runtime-e2e.test.js`，原因是跨仓库 Python Connector 依赖，不是付费模型调用。

## 必须保持的不变量

- 通过 WorldCommands / SkillRegistry 和 Runtime 写入互斥修改世界；历史恢复与导入不能交错写入。
- 回滚恢复规则、authority、对象与可移植物理状态；物理检查点不承诺求解器精确回放。
- 恢复过程暂停世界推进与规则事件；失败必须保留原始错误和回滚错误。
- 历史验收记录不冒充当前验证；`provisional` 不升级成 `ready`。
- 产品页切换保留同一画布和 Runtime；界面不复制 Runtime 事实。
- 生成输入确认、上传及费用授权仍通过原有流程；不在前端或导出物保存凭据。

## 本轮任务映射

每个任务仅在主要所有者的 `tasks.jsonl` 中维护权威状态。AS 编号是交接别名，不复制已有细粒度任务。

| 交接别名 | 权威任务／已有条目 | 本轮边界 |
| --- | --- | --- |
| AS-00 | `ACCEPTANCE-BASELINE`；既有 `RUNTIME-001/002/003`、`EXPERIMENT-005` | 固定提交、独立安装校验、明确限制；不批量清理历史 backlog |
| AS-01 | `ACCEPTANCE-WORLD`；既有 `BASELINE-003` 至 `BASELINE-009` | 复用 viability 和跨世界实验，补标准场景／重复回归与阶段报告 |
| AS-02 | `ACCEPTANCE-TASK-CONTROL` | 同屏任务模式、选择引用、取消与安全重试 |
| AS-06 | `ACCEPTANCE-BROWSER`；既有 `STUDIO-001`、`BASELINE-002` | 固化浏览器入口、编辑、取消、保存及画布身份验收 |

AS-03 在任务场景与取消契约稳定后建立真实模型基线；调用预算未授权时不自动运行在线评测。AS-04 的真实生成同样等待服务、凭据和预算；协议测试应独立推进。AS-05 验收完整资产字节的迁移，现有 JSON 存档不等于作品包。AS-07 的真人首次使用必须由未参与开发的人完成，Agent 走查不能替代。

## 仍未证明

真实 LLM 完整物理任务成功率、真实付费生成产物交互、作品在干净浏览器的完整迁移、真人首次使用及发布性能门槛均未由基线证明。标准场景 admission 可能仍为 provisional，运行时交互验证不能改变资产准入结论。不得把构建成功、固定协议数据或单张截图作为这些项目通过的依据。
