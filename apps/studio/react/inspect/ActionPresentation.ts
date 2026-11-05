export const LABELS:Record<string,string>={
  pickup:'拿取',place:'放置',open:'打开',close:'关闭',push:'推动',drag:'拖动',
  rotate:'旋转刚体',slide:'滑动关节',rotateJoint:'旋转关节',
  turn_on:'开启',turn_off:'关闭',pull_out:'抽出',return:'放回',write:'修改文字'
};
export const REASONS:Record<string,string>={
  ACTOR_NOT_FOUND:'未找到指定 Agent',ACTOR_NOT_AGENT:'选中角色不是 Agent',
  ACTOR_REQUIRED_FOR_REACH_CHECK:'尚未选择 Agent',OUT_OF_REACH:'当前距离过远',
  OCCLUDED:'目标被遮挡',NOT_HOLDING_OBJECT:'Agent 尚未持有物体',
  HANDS_FULL:'Agent 正在持有其他物体',TARGET_NOT_DYNAMIC:'物体不是动态刚体',
  EXECUTOR_UNAVAILABLE:'当前未实现此动作',ACTION_IN_PROGRESS:'已有动作正在执行',
  RUNTIME_VERIFICATION_REQUIRED:'资产尚未通过物理准入',
  TARGET_PHYSICS_UNAVAILABLE:'目标没有可用的物理碰撞体',
  SIMULATION_PAUSED:'模拟暂停'
};
