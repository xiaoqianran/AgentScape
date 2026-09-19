import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { TaskPanelView } from '../../apps/studio/react/agent/TaskPanelView.tsx';

function controller(state) {
  return {
    subscribe:()=>()=>{},
    snapshot:()=>state,
    runQuickTask:vi.fn(async()=>null),
    markActivityRead:vi.fn(),
    openSettings:vi.fn()
  };
}

describe('TaskPanelView contract',()=>{
  it('projects controller status, journey and activity without owning execution state',()=>{
    const html=renderToStaticMarkup(createElement(TaskPanelView,{controller:controller({
      busy:true,
      available:true,
      activeTaskKey:'runtime.navigation',
      activityCount:2,
      status:{state:'running',label:'正在执行',detail:'检查世界状态',action:null},
      journey:{
        intent:'把杯子放到桌上',
        state:'success',
        actions:[{label:'拿起 cup_01',state:'success',outcome:{state:'verified'}}],
        changes:[{label:'放置 cup_01',state:'success',detail:'已验证'}],
        result:{state:'success',label:'成功',detail:'世界状态已经验证。'}
      },
      logs:[{id:1,text:'tool executed',kind:'result'}]
    })}));
    expect(html).toContain('task-console is-executing');
    expect(html).toContain('正在执行');
    expect(html).toContain('把杯子放到桌上');
    expect(html).toContain('拿起 cup_01');
    expect(html).toContain('放置 cup_01');
    expect(html).toContain('世界状态已经验证。');
    expect(html).toContain('tool executed');
  });

  it('keeps natural-language quick tasks disabled when the Agent is unavailable while Runtime tasks remain renderable',()=>{
    const html=renderToStaticMarkup(createElement(TaskPanelView,{controller:controller({
      busy:false,
      available:false,
      activeTaskKey:null,
      activityCount:0,
      status:{state:'offline',label:'LLM Agent 未连接',detail:'Runtime 验收仍可直接运行；自然语言任务需要配置 Agent Gateway。',action:'配置'},
      journey:null,
      logs:[]
    })}));
    expect(html).toContain('LLM Agent 未连接');
    expect(html).toContain('Runtime 验收');
    expect(html).toContain('常用任务');
    expect(html).toContain('配置');
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*><strong>拿起杯子<\/strong>/);
  });
});
