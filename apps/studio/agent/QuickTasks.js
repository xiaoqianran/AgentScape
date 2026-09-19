import { generatedPlacementDemoTask } from '../demos/generated-placement/generatedPlacementDemo.js';
import { AGENT_RUNTIME_TESTS } from './AgentRuntimeTestRunner.js';

export const GENERATED_PLACEMENT_TASK = generatedPlacementDemoTask();

export const QUICK_TASK_GROUPS = Object.freeze([
  {
    label:'Runtime 验收',
    tasks:AGENT_RUNTIME_TESTS
  },
  {
    label:'常用任务',
    tasks:[
      { title:'拿起杯子', detail:'走到杯子前并安全拿起', prompt:'让 agent_01 走到 cup_01 前并拿起杯子' },
      { title:'把杯子放到桌上', detail:'放到桌面并确认稳定', prompt:'让 agent_01 先拿起 cup_01，再把它放到 table_01 上并确认稳定' },
      { title:'打开柜门', detail:'走到柜子前并确认打开', prompt:'让 agent_01 走到 cabinet_01 前并打开柜门' },
      { title:'放下手中物体', detail:'释放当前手持物体', prompt:'让 agent_01 放下当前拿着的物体' }
    ]
  },
  {
    label:'流程任务',
    tasks:[
      { title:GENERATED_PLACEMENT_TASK.title, detail:GENERATED_PLACEMENT_TASK.detail, prompt:GENERATED_PLACEMENT_TASK.prompt, demo:GENERATED_PLACEMENT_TASK.id, wide:true },
      { title:'完成具身任务', detail:'打开 → 拿起 → 放置 → 验证', prompt:'让 agent_01 打开 cabinet_01，确认柜门完成打开后拿起 cup_01，再把杯子放到 table_01 上；每一步失败都不要继续后续动作', wide:true },
      { title:'建立咖啡角', detail:'让智能体规划完整场景流程', prompt:'建立一个咖啡角', wide:true }
    ]
  }
]);
