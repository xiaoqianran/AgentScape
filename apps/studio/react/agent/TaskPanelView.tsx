import { StudioIcon } from '../shared/StudioIcon';
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
  cancel?:()=>unknown;
  retry?:()=>unknown;
  focusCurrentTarget?:()=>unknown;
  checkStandardTask?:()=>Promise<unknown>;
  prepareStandardTask?:()=>Promise<unknown>;
  runStandardTask?:()=>Promise<unknown>;
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
        <p>描述目标，查看执行过程，并确认世界中真实发生的变化。</p>
        <div className="product-flow" aria-label="Agent workflow">
          <span>目标</span><i>→</i><span>行动</span><i>→</i><span>验证</span><i>→</i><span>结果</span>
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

      <div className="task-controls" aria-label="任务控制">
        {state.busy ? <button id="cancel-task" type="button" disabled={!state.canCancel} onClick={()=>controller.cancel?.()}>{state.status.state==='cancelling' ? '正在取消…' : state.canCancel ? '停止任务' : '当前验收运行中'}</button> : null}
        {!state.busy && state.canRetry ? <button id="retry-task" type="button" onClick={()=>void controller.retry?.()}>重新观察并重试</button> : null}
        {journey?.actions?.length ? <button id="focus-task-target" type="button" onClick={()=>controller.focusCurrentTarget?.()}>聚焦当前目标</button> : null}
      </div>
      <div className="task-scroll">
        <section className="standard-task" aria-label="柜内取杯标准任务">
          <h2>把柜内杯子放到桌上</h2>
          <p>纪念大厅、林间工坊和魔女小屋可准备此任务。准备会替换当前场景对象，可撤销；不调用生成服务。</p>
          <div className="task-controls">
            <button id="prepare-standard-task" type="button" disabled={state.busy} onClick={()=>void controller.prepareStandardTask?.()}>准备标准任务场景</button>
            <button id="check-standard-task" type="button" disabled={state.busy} onClick={()=>void controller.checkStandardTask?.()}>检查当前条件</button>
            <button id="run-standard-task" type="button" disabled={state.busy || !state.available} onClick={()=>void controller.runStandardTask?.()}>开始标准任务</button>
          </div>
          {state.standardTask ? <div id="standard-task-conditions" role="status">
            {state.standardTask.supported ? <p>上次检查的初始条件满足；开始任务时会重新检查，执行结果仍需验证。</p> : <ul>{state.standardTask.reasons?.map((reason:any,index:number)=><li key={index}>{reason.message} <small>({reason.code})</small></li>)}</ul>}
            {state.standardTask.admission ? <small>场景准入：{state.standardTask.admission}</small> : null}
          </div> : null}
          {!state.available ? <p>自然语言执行尚未连接模型服务。仍可准备、检查场景和使用开发验收工具。<button type="button" className="text-button" onClick={()=>controller.openSettings()}>配置服务</button></p> : null}
        </section>
        {journey ? <section id="agent-journey" className="agent-journey" data-state={journey?.state || 'idle'} aria-label="Agent 执行过程">
          <article className="agent-stage" data-stage="intent" data-state={journey ? 'success' : 'idle'}>
            <header><span>01</span><strong>想做什么</strong><i>目标</i></header>
            <p id="agent-intent">{journey?.intent || '等待一个目标。'}</p>
          </article>
          <article className="agent-stage" data-stage="actions" data-state={actionState}>
            <header><span>02</span><strong>做了什么</strong><i>行动</i></header>
            <div id="agent-actions" className="agent-stage-list">
              {journey?.actions?.length ? journey.actions.map((entry:any,index:number)=>(
                <JourneyRow key={`${entry.label}:${index}`} entry={entry} detail={outcomeLabel(entry.outcome)} />
              )) : <p>{journey?.state === 'running' ? '正在理解目标并规划下一步…' : 'Agent 的执行步骤会显示在这里。'}</p>}
            </div>
          </article>
          <article className="agent-stage" data-stage="changes" data-state={changeState}>
            <header><span>03</span><strong>世界发生了什么变化</strong><i>变化</i></header>
            <div id="agent-changes" className="agent-stage-list">
              {journey?.changes?.length ? journey.changes.map((entry:any,index:number)=>(
                <JourneyRow key={`${entry.label}:${index}`} entry={entry} detail={entry.detail} />
              )) : <p>{journey?.state === 'running' ? '等待第一个经过 Runtime 验证的世界变化…' : '本次任务没有已确认的世界变化。'}</p>}
            </div>
          </article>
          <article className="agent-stage" data-stage="result" data-state={journey?.result?.state || 'idle'}>
            <header><span>04</span><strong>最后是否成功</strong><i>结果</i></header>
            <div className="agent-result-copy">
              <strong id="agent-result-label">{journey?.result?.label || '等待执行'}</strong>
              <p id="agent-result-detail">{journey?.result?.detail || '完成后会明确显示成功、部分完成或失败。'}</p>
            </div>
          </article>
        </section> : <section className="agent-welcome"><div className="agent-welcome-icon"><StudioIcon name="agent" size={28} /></div><div><h2>先给智能体一个目标</h2><p>选择下方任务，或在底部输入指令。执行后，这里会显示每一步的行动与验证结果。</p></div></section>}

        <div className="quick-tasks">
          {QUICK_TASK_GROUPS.filter((group:any)=>group.label!=='Runtime 验收').map((group:any)=>(
            <TaskGroup key={group.label} group={group} state={state} controller={controller} />
          ))}
          <details className="task-diagnostics"><summary>开发与验收工具<span>验证运行时能力</span></summary>
            {QUICK_TASK_GROUPS.filter((group:any)=>group.label==='Runtime 验收').map((group:any)=><TaskGroup key={group.label} group={group} state={state} controller={controller} />)}
          </details>
        </div>

        <details className="activity-panel" onToggle={(event)=>{ if ((event.currentTarget as HTMLDetailsElement).open) controller.markActivityRead(); }}>
          <summary><span>技术日志</span><small id="activity-count">{state.activityCount}</small></summary>
          <div id="log" className="log" aria-label="任务活动日志">
            {state.logs.map((entry:any)=><div key={entry.id} className={`log-row ${entry.kind}`}>{entry.text}</div>)}
          </div>
        </details>
      </div>
    </section>
  );
}

function TaskGroup({ group,state,controller }: { group:any;state:any;controller:TaskController }) {
  return <section className="task-group"><div className="section-label">{group.label}</div><div className="task-grid">{group.tasks.map((task:any)=>{
    const key=task.id || task.demo || task.prompt || task.title;
    const disabled=state.busy || (!task.id && !state.available);
    return <button key={key} className={'task-card'+(task.wide?' wide':'')+(state.activeTaskKey===key?' is-running':'')} type="button" disabled={disabled} onClick={()=>void controller.runQuickTask(task)}><strong>{task.title}</strong><span>{task.detail}</span><StudioIcon name="arrow" size={15} /></button>;
  })}</div></section>;
}
