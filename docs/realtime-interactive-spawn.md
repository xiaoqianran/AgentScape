# 实时交互生成

实时生成由 GenerationOrchestrator 管理请求，由 WorldRuntime 负责原子提交。流程为：用户位置命中查询、取得支撑面和法线、生成资产制品、编译 manifest、校验交互和物理、创建临时预览、完成空间验证、提交实体。

每个任务记录 requestId、operationId、世界 revision、资产 hash、来源和取消状态。重复请求必须幂等。生成失败、取消或校验失败都必须清理预览对象、物理实体、音频句柄和注册表记录。

生成器不直接写入宿主 Scene。只有通过编译、验证和 WorldRuntime 提交的实体才能进入正式交互世界。
