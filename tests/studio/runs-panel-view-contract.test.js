import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { RunsPanelView } from '../../apps/studio/react/runs/RunsPanelView.tsx';

const controller=(runs)=>({
  subscribe:()=>()=>{},
  snapshot:()=>({runs})
});

describe('RunsPanelView contract',()=>{
  it('projects run status labels, titles and duration from the external store snapshot',()=>{
    const html=renderToStaticMarkup(createElement(RunsPanelView,{controller:controller([
      {id:'run_1',title:'放置杯子',prompt:'place cup',status:'success',durationMs:1250,detail:'完成',journey:null},
      {id:'run_2',title:'打开柜门',prompt:'open cabinet',status:'error',durationMs:80,detail:'失败',journey:null}
    ])}));
    expect(html).toContain('放置杯子');
    expect(html).toContain('打开柜门');
    expect(html).toContain('已完成');
    expect(html).toContain('失败');
    expect(html).toContain('1.3 秒');
    expect(html).toContain('80 毫秒');
  });

  it('renders the empty-state contract for a fresh session',()=>{
    const html=renderToStaticMarkup(createElement(RunsPanelView,{controller:controller([])}));
    expect(html).toContain('暂无执行记录');
    expect(html).toContain('已完成、部分完成、失败和取消的智能体任务会显示在这里。');
  });
});
