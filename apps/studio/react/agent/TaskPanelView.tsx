import { useSyncExternalStore } from 'react';
import { outcomeLabel } from '../../agent/AgentJourney.js';
import { QUICK_TASK_GROUPS } from '../../agent/QuickTasks.js';
import './TaskPanel.css';

type TaskController = {
  subscribe:(listener:()=>void)=>()=>void;
  snapshot:()=>any;
  runQuickTask:(task:any)=>Promise<unknown>;
  markActivityRead:()=>void;
  openSettings:()=>void;
};

function entryState(entries:any[] = [], runningState = 'running') {
  if (!entries.length) return runningState === 'running' ? 'waiting' : 'idle';
  if (entries.some((entry)=>entry.state === 'error')) return 'error';
  return 'success';
}

function JourneyRow({ entry, detail }: { entry:any; detail?:string }) {
  const state = entry.state || 'done';
  const marker = state === 'success' ? '✓' : state === 'error' ? '!' : state === 'skipped' ? '–' : '•';
  return (
    <div className="agent-stage-row" data-state={state}>
      <span className="agent-stage-marker">{marker}</span>
      <div>
        <strong>{entry.label}</strong>
        {detail && detail !== '状态未知' ? <small>{detail}</small> : null}
      </div>
    </div>
  );
}

export function TaskPanelView({ controller }: { controller:TaskController }) {
  const state = useSyncExternalStore(controller.subscribe,controller.snapshot,controller.snapshot);
  const journey = state.journey;
  const actionState = !journey ? 'idle' : journey.state === 'running' ? 'running' : entryState(journey.actions,journey.state);
  const changeState = !journey ? 'idle' : journey.state === 'running' && !journey.changes?.length ? 'waiting' : entryState(journey.changes,journey.state);

  return (
    <section className={`task-console${state.busy ? ' is-executing' : ''}`} aria-label="任务">
      <header className="screen-heading product-heading">
        <div className="eyebrow">AGENT</div>
        <h1>让世界发生变化</h1>
        <p>目标 → 行动 → 世界变化 → 结果。技术日志只在需要时展开。</p>
        <div className="product-flow" aria-label="Agent workflow">
          <span>Intent</span><i>→</i><span>Action</span><i>→</i><span>World</span><i>→</i><span>Result</span>
        </div>
      </header>

      <div id="task-state" className="task-state" data-state={state.status.state} role="status" aria-live="polite" aria-busy={state.busy}>
        <span className="task-state-dot" />
        <div className="task-state-copy">
          <strong id="task-state-label">{state.status.label}</strong>
          <span id="task-state-detail">{state.status.detail}</span>
        </div>
        {state.status.action ? <button id="task-state-action" className="text-button" type="button" onClick={()=>controller.openSettings()}>{state.status.action}</button> : null}
      </div>

      <div className="task-scroll">
        <section id="agent-journey" className="agent-journey" data-state={journey?.state || 'idle'} aria-label="Agent 执行过程">
          <article className="agent-stage" data-stage="intent" data-state={journey ? 'success' : 'idle'}>
            <header><span>01</span><strong>想做什么</strong><i>Intent</i></header>
            <p id="agent-intent">{journey?.intent || '等待一个目标。'}</p>
          </article>
          <article className="agent-stage" data-stage="actions" data-state={actionState}>
            <header><span>02</span><strong>做了什么</strong><i>Actions</i></header>
            <div id="agent-actions" className="agent-stage-list">
              {journey?.actions?.length ? journey.actions.map((entry:any,index:number)=>(
                <JourneyRow key={`${entry.label}:${index}`} entry={entry} detail={outcomeLabel(entry.outcome)} />
              )) : <p>{journey?.state === 'running' ? '正在理解目标并规划下一步…' : 'Agent 的执行步骤会显示在这里。'}</p>}
            </div>
          </article>
          <article className="agent-stage" data-stage="changes" data-state={changeState}>
            <header><span>03</span><strong>世界发生了什么变化</strong><i>World</i></header>
            <div id="agent-changes" className="agent-stage-list">
              {journey?.changes?.length ? journey.changes.map((entry:any,index:number)=>(
                <JourneyRow key={`${entry.label}:${index}`} entry={entry} detail={entry.detail} />
              )) : <p>{journey?.state === 'running' ? '等待第一个经过 Runtime 验证的世界变化…' : '本次任务没有已确认的世界变化。'}</p>}
            </div>
          </article>
          <article className="agent-stage" data-stage="result" data-state={journey?.result?.state || 'idle'}>
            <header><span>04</span><strong>最后是否成功</strong><i>Result</i></header>
            <div className="agent-result-copy">
              <strong id="agent-result-label">{journey?.result?.label || '等待执行'}</strong>
              <p id="agent-result-detail">{journey?.result?.detail || '完成后会明确显示成功、部分完成或失败。'}</p>
            </div>
          </article>
        </section>

        <div className="quick-tasks">
          {QUICK_TASK_GROUPS.map((group:any)=>(
            <section className="task-group" key={group.label}>
              <div className="section-label">{group.label}</div>
              <div className="task-grid">
                {group.tasks.map((task:any)=>{
                  const key = task.id || task.demo || task.prompt || task.title;
                  const disabled = state.busy || (!task.id && !state.available);
                  return (
                    <button
                      key={key}
                      className={`task-card${task.wide ? ' wide' : ''}${state.activeTaskKey === key ? ' is-running' : ''}`}
                      type="button"
                      disabled={disabled}
                      onClick={()=>void controller.runQuickTask(task)}
                    >
                      <strong>{task.title}</strong><span>{task.detail}</span>
                    </button>
                  );
                })}
              </div>
            </section>
          ))}
        </div>

        <details className="activity-panel" onToggle={(event)=>{ if ((event.currentTarget as HTMLDetailsElement).open) controller.markActivityRead(); }}>
          <summary><span>Raw activity</span><small id="activity-count">{state.activityCount}</small></summary>
          <div id="log" className="log" aria-label="任务活动日志">
            {state.logs.map((entry:any)=><div key={entry.id} className={`log-row ${entry.kind}`}>{entry.text}</div>)}
          </div>
        </details>
      </div>
    </section>
  );
}
