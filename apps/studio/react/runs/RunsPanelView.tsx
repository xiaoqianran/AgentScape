import { useState, useSyncExternalStore } from 'react';
import { STATUS_LABELS, formatDuration } from '../../ui/runs/RunsPanel.js';
import '../../ui/runs/RunsPanel.css';

type RunsController = {
  subscribe:(listener:()=>void)=>()=>void;
  snapshot:()=>{runs:any[]};
};

function Journey({ journey }: { journey:any }) {
  const stages:any[] = [
    ['想做什么',journey.intent || '—',[]],
    ['做了什么',journey.actions?.length ? '' : '没有记录动作。',journey.actions || []],
    ['世界发生了什么变化',journey.changes?.length ? '' : '没有已确认的世界变化。',journey.changes || []],
    ['最后是否成功',journey.result?.detail || journey.result?.label || '—',[]]
  ];
  return <section className="run-journey">{stages.map(([label,copy,items])=>(
    <article key={label}>
      <strong>{label}</strong>
      {copy ? <p>{copy}</p> : null}
      {items.length ? <div className="run-journey-list">{items.map((item:any,index:number)=>(
        <div key={`${item.label}:${index}`} data-state={item.state || 'done'}>
          <span>{item.state === 'success' ? '✓' : item.state === 'error' ? '!' : item.state === 'skipped' ? '–' : '•'}</span>
          <div><b>{item.label}</b>{item.detail ? <small>{item.detail}</small> : null}</div>
        </div>
      ))}</div> : null}
    </article>
  ))}</section>;
}

export function RunsPanelView({ controller }: { controller:RunsController }) {
  const { runs } = useSyncExternalStore(controller.subscribe,controller.snapshot,controller.snapshot);
  const [filter,setFilter] = useState('all');
  const [selectedId,setSelectedId] = useState<string|null>(null);
  const visible = filter === 'all' ? runs : runs.filter((run)=>run.status === filter);
  const selected = runs.find((run)=>run.id === selectedId) || null;

  return (
    <section className="runs-console" aria-label="执行记录">
      <header className="screen-heading product-heading product-heading--utility split-heading">
        <div>
          <div className="eyebrow">RUNS</div>
          <h1>查看任务历史</h1>
          <p>查看本次浏览器会话中任务发生了什么，以及任务停在了哪里。</p>
        </div>
        <label className="compact-filter">状态
          <select id="runs-filter" value={filter} onChange={(event)=>setFilter(event.target.value)}>
            <option value="all">全部</option><option value="success">已完成</option><option value="partial">部分完成</option><option value="error">失败</option><option value="cancelled">已取消</option>
          </select>
        </label>
      </header>
      <div className="runs-scroll">
        {!visible.length ? <div id="runs-empty" className="empty-state"><strong>暂无执行记录</strong><span>已完成、部分完成、失败和取消的智能体任务会显示在这里。</span></div> : (
          <div id="runs-table-wrap" className="runs-table-wrap">
            <table className="runs-table">
              <thead><tr><th>状态</th><th>任务</th><th>耗时</th></tr></thead>
              <tbody id="runs-body">{visible.map((run)=>{
                const [label,icon] = (STATUS_LABELS as Record<string,string[]>)[run.status] || [run.status,'•'];
                const select=()=>setSelectedId(run.id);
                return <tr key={run.id} tabIndex={0} role="button" onClick={select} onKeyDown={(event)=>{ if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); select(); } }}>
                  <td><span className="run-status" data-state={run.status}><i>{icon}</i>{label}</span></td>
                  <td title={run.title}>{run.title}</td><td>{formatDuration(run.durationMs)}</td>
                </tr>;
              })}</tbody>
            </table>
          </div>
        )}
        {selected ? <section id="run-detail" className="run-detail" aria-live="polite">
          <div className="run-detail-heading"><strong>{selected.title}</strong><span>{formatDuration(selected.durationMs)}</span></div>
          <p>{selected.detail || '暂无更多详情。'}</p>
          {selected.journey ? <Journey journey={selected.journey} /> : null}
          <details className="disclosure"><summary>原始任务</summary><div className="run-prompt">{selected.prompt}</div></details>
        </section> : null}
      </div>
    </section>
  );
}
