# AgentScape MCP：学校创建真实验收（2026-11-14）

## 环境

PC2 仓库 D:\a_programming_list\A-Python-Project\wk08\AgentScape，基线 be45fed。
Studio 为 127.0.0.1:5173，MCP 为 127.0.0.1:39015。
本轮通过 AgentDock 真实 MCP 创建私有 monument-hall 测试世界；这不是已经部署或渲染完成的学校。没有记录登录凭据或 Bearer Token。

## 实际执行过程及证据

1. Windows 计划任务 AgentScape-Studio、AgentScape-World-MCP 启动成功；MCP 工具搜索恢复。Studio 当前浏览器场景仍返回 STUDIO_NOT_CONNECTED。
2. session_create 成功创建私有世界；world_observe 确认默认 Agent、柜子、杯子、桌子。
3. scene_apply 批量添加 3 张课桌，revision 0 -> 3。
4. scene_add_model 首次创建教室门失败：ASSET_PHYSICS_VERIFICATION_FAILED。本地 ArticulationVerifier 报告定位 COLLISION_REGRESSION，旋转门板撞到实心门框；修改门框为窄立柱后，同一接口成功，compiler/runtime admission 均 ready。
5. scene_add_model 添加教学楼视觉外壳、操场、黑板，revision 8。注意这些是视觉 Recipe，不是完整碰撞与导航建筑。
6. scene_observe 发现物理门 open/close/rotateJoint、关节限位；scene_interact invoke open 自动使 Agent 接近门。scene_job 返回 succeeded，verified=true，physicsVerified=true，joint-motor 目标 1.4 rad，实际 1.344 rad，误差 0.056 rad。
7. scene_interact navigate 到 [0,0,4] 附近，scene_job 返回 arrived、verified，revision 9。没有执行坐下和真实上课。
8. scene_verify 共 8 项：对象存在、门交互证据等 7 项通过；world-valid 未通过，6 处 P_OVERLAP，包括默认柜子/杯子、相邻课桌、视觉建筑与 Agent。
9. world_save 拒绝未发布的私有编译资产，错误 WORLD_ASSET_NOT_PUBLISHED；属于资产所有权边界，禁止直接放宽。
10. scene_save 成功导出完整 agentscape.project-bundle；world_export 导出旧场景 JSON，但不能独立恢复资源。
11. 本轮新增 scene_import，复用现有场景包哈希验证、隔离导入和 Runtime 事务，配套 HTTP MCP 回归测试通过。重启真实 MCP 服务后，使用先前学校 scene_save 包在新 session 中 scene_import 成功恢复 11 个对象，机械门可再次观察；历史 OPEN 验证报告 INTERACTION_NOT_VERIFIED（正确清空）。再执行 CLOSE，scene_job 真实返回 succeeded、physicsVerified:true。
12. 本轮新增编译失败的安全裁剪诊断：允许 AI 收到具体 part、action、COLLISION_REGRESSION 及碰撞深度，而不是只能看到通用错误码。

## MCP 功能（新接口后总计 40 个）

- 会话/连接：studio_pair_create、studio_session_status、session_attach、studio_session_close、session_create、session_status、session_close。
- 构建/发布/列表：asset_build_submit、asset_build_status、asset_build_cancel、asset_publish、asset_inspect、asset_list。
- 代码世界：studio_project（read、write、patch、file_read、file、resource、preview_batch、apply_batch、discard_batch、undo_batch、run、save、open、close）。
- WASM 草稿：authoring_execute、authoring_observe、authoring_prepare、authoring_promote、authoring_update、authoring_verify、authoring_export。
- 私有世界：world_observe、object_inspect、skills_list、action_execute、world_verify、world_export、world_save、world_restore。
- 统一 Scene：scene_observe、scene_thermal、scene_apply、scene_interact、scene_job、scene_cancel、scene_verify、scene_add_model、scene_save、scene_import（新增）、scene_set_style。

## 具体问题及处理状态

| ID | 优先级 | 问题 / 证据 | 状态 |
|---|---|---|---|
| MCP-SCHOOL-01 | P0 | Studio 启动不会自动拉起 MCP；计划任务停止后 39015 拒绝连接 | 本次已通过计划任务重启；待统一启动或健康检查 |
| MCP-SCHOOL-02 | P0 | scene_save 有完整资源包，MCP 没有导入接口；world_save 排除未发布的本地资产 | 已新增 scene_import，保留 world_save 的权限边界 |
| MCP-SCHOOL-03 | P1 | 机械门编译失败只返回通用错误码；实际失败为门框与门板 COLLISION_REGRESSION | 本次已增加安全裁剪的部件级诊断 |
| MCP-SCHOOL-04 | P1 | session_create 仅支持 monument-hall，不能创建空白学校 | 待支持 blank 等通用模板 |
| MCP-SCHOOL-05 | P1 | world-valid 把视觉外壳、房间容纳与合法柜内杯子视作包围盒重叠 | 待区分视觉 / 合法容纳 / 硬碰撞；不要一律忽略 |
| MCP-SCHOOL-06 | P1 | 缺少从规划、批量锻造、修复到验收的高层 World Builder 工作流 | 待设计通用编排层，不增加硬编码 create_school |
| MCP-SCHOOL-07 | P2 | Vite 服务在线不代表浏览器 Studio 已经连接 | 待改进连接提示与引导 |
| MCP-SCHOOL-08 | P2 | 缺少学生坐下、座位占用、课堂任务等可复用已验证动作 | 待扩展组合行为和语义事实 |
| MCP-SCHOOL-09 | P2 | scene_save / scene_import 单请求 4 MiB 配额不适合大型学校 | 待接入分块/内容寻址世界存储 |

## 新接口验收边界

scene_import 的输入为 scene_save 的 value 完整包，支持已连接 Studio 或私有 MCP 会话；依照原有 ScenePersistence.importProject 校验。JSON 最大限制为当前服务的 maxExportBytes（默认 4 MiB），超限拒绝。场景导入不恢复历史动作已验证证据。

HTTP MCP 回归包含：创建本地临时资产、scene_save、跨会话 scene_import、重新观察实体、篡改资产哈希后拒绝导入且保留现有世界。原有授权、所有权和回滚边界保持不变。

## 近期优先级

先完善部件级物理错误诊断，再提供空白世界，修正复杂世界的重叠验收策略，然后建立 World Builder 的批量规划/修复/验证工作流，最后支持大型世界包分块恢复。

本次未声称 Studio 图形界面已展示学校，也未声称学校满足所有验收要求。
