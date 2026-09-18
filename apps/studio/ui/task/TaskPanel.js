import { generatedPlacementDemoTask } from '../../demos/generated-placement/generatedPlacementDemo.js';
import './TaskPanel.css';
import { AGENT_RUNTIME_TESTS } from '../../agent/AgentRuntimeTestRunner.js';
import {
  addAgentTool,
  applyAgentSequence,
  createAgentJourney,
  finalizeAgentJourney,
  journeyRunDetail,
  outcomeLabel
} from './AgentJourney.js';

const GENERATED_PLACEMENT_TASK = generatedPlacementDemoTask();

const QUICK_TASK_GROUPS = [
  {
    label: 'Runtime 验收',
    tasks: AGENT_RUNTIME_TESTS
  },
  {
    label: '常用任务',
    tasks: [
      { title: '拿起杯子', detail: '走到杯子前并安全拿起', prompt: '让 agent_01 走到 cup_01 前并拿起杯子' },
      { title: '把杯子放到桌上', detail: '放到桌面并确认稳定', prompt: '让 agent_01 先拿起 cup_01，再把它放到 table_01 上并确认稳定' },
      { title: '打开柜门', detail: '走到柜子前并确认打开', prompt: '让 agent_01 走到 cabinet_01 前并打开柜门' },
      { title: '放下手中物体', detail: '释放当前手持物体', prompt: '让 agent_01 放下当前拿着的物体' }
    ]
  },
  {
    label: '流程任务',
    tasks: [
      { title: GENERATED_PLACEMENT_TASK.title, detail: GENERATED_PLACEMENT_TASK.detail, prompt: GENERATED_PLACEMENT_TASK.prompt, demo: GENERATED_PLACEMENT_TASK.id, wide: true },
      { title: '完成具身任务', detail: '打开 → 拿起 → 放置 → 验证', prompt: '让 agent_01 打开 cabinet_01，确认柜门完成打开后拿起 cup_01，再把杯子放到 table_01 上；每一步失败都不要继续后续动作', wide: true },
      { title: '建立咖啡角', detail: '让智能体规划完整场景流程', prompt: '建立一个咖啡角', wide: true }
    ]
  }
];

const escapeAttr = (value) => String(value).replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;');

const quickTaskMarkup = () => QUICK_TASK_GROUPS.map((group) => `
  <section class="task-group">
    <div class="section-label">${group.label}</div>
    <div class="task-grid">
      ${group.tasks.map((task) => `<button class="task-card${task.wide ? ' wide' : ''}" type="button"${task.prompt ? ` data-prompt="${escapeAttr(task.prompt)}"` : ''}${task.id ? ` data-runtime-test="${escapeAttr(task.id)}"` : ''}${task.demo ? ` data-demo="${escapeAttr(task.demo)}"` : ''}><strong>${task.title}</strong><span>${task.detail}</span></button>`).join('')}
    </div>
  </section>`).join('');

export const taskPanelMarkup = () => `
  <section class="task-console" aria-label="任务">
    <header class="screen-heading">
      <div class="eyebrow">AGENT</div>
      <h1>让世界发生变化</h1>
      <p>目标 → 行动 → 世界变化 → 结果。技术日志只在需要时展开。</p>
    </header>

    <div id="task-state" class="task-state" data-state="ready" role="status" aria-live="polite">
      <span class="task-state-dot"></span>
      <div class="task-state-copy">
        <strong id="task-state-label">就绪</strong>
        <span id="task-state-detail">选择常用任务，或在下方描述你自己的目标。</span>
      </div>
      <button id="task-state-action" class="text-button hidden" type="button">配置</button>
    </div>

    <div class="task-scroll">
      <section id="agent-journey" class="agent-journey" data-state="idle" aria-label="Agent 执行过程">
        <article class="agent-stage" data-stage="intent" data-state="idle">
          <header><span>01</span><strong>想做什么</strong><i>Intent</i></header>
          <p id="agent-intent">等待一个目标。</p>
        </article>
        <article class="agent-stage" data-stage="actions" data-state="idle">
          <header><span>02</span><strong>做了什么</strong><i>Actions</i></header>
          <div id="agent-actions" class="agent-stage-list"><p>Agent 的执行步骤会显示在这里。</p></div>
        </article>
        <article class="agent-stage" data-stage="changes" data-state="idle">
          <header><span>03</span><strong>世界发生了什么变化</strong><i>World</i></header>
          <div id="agent-changes" class="agent-stage-list"><p>只显示 Runtime 确认过的世界变更。</p></div>
        </article>
        <article class="agent-stage" data-stage="result" data-state="idle">
          <header><span>04</span><strong>最后是否成功</strong><i>Result</i></header>
          <div class="agent-result-copy">
            <strong id="agent-result-label">等待执行</strong>
            <p id="agent-result-detail">完成后会明确显示成功、部分完成或失败。</p>
          </div>
        </article>
      </section>
      <div class="quick-tasks">${quickTaskMarkup()}</div>
      <details class="activity-panel">
        <summary><span>Raw activity</span><small id="activity-count">0</small></summary>
        <div id="log" class="log" aria-label="任务活动日志"></div>
      </details>
    </div>
  </section>`;

export class TaskPanel {
  constructor({ root, commandForm, commandInput, commandButton, setView, onRun = () => {}, onOpenSettings = () => {}, demoRunners = {}, runtimeTestRunner = null }) {
    this.root = root;
    this.commandForm = commandForm;
    this.commandInput = commandInput;
    this.commandButton = commandButton;
    this.commandButtonLabel = commandButton.querySelector('span');
    this.setView = setView;
    this.onRun = onRun;
    this.onOpenSettings = onOpenSettings;
    this.demoRunners = demoRunners;
    this.runtimeTestRunner = runtimeTestRunner;
    this.agent = null;
    this.gateway = null;
    this.busy = false;
    this.available = true;
    this.activeTaskButton = null;
    this.activityCount = 0;
    this.journey = null;
    this.journeySource = null;

    const q = (selector) => root.querySelector(selector);
    this.consoleEl = q('.task-console');
    this.state = q('#task-state');
    this.stateLabel = q('#task-state-label');
    this.stateDetail = q('#task-state-detail');
    this.stateAction = q('#task-state-action');
    this.logEl = q('#log');
    this.activityPanel = q('.activity-panel');
    this.activityCountEl = q('#activity-count');
    this.journeyEl = q('#agent-journey');
    this.intentEl = q('#agent-intent');
    this.actionsEl = q('#agent-actions');
    this.changesEl = q('#agent-changes');
    this.resultLabelEl = q('#agent-result-label');
    this.resultDetailEl = q('#agent-result-detail');
    this.journeyStages = Object.fromEntries(
      [...root.querySelectorAll('.agent-stage')].map((node) => [node.dataset.stage, node])
    );
    this.taskButtons = [...root.querySelectorAll('.task-card')];
    this.bind();
  }

  bind() {
    this.activityPanel.addEventListener('toggle', () => {
      if (!this.activityPanel.open) return;
      this.activityCount = 0;
      this.activityCountEl.textContent = '0';
      requestAnimationFrame(() => { this.logEl.scrollTop = this.logEl.scrollHeight; });
    });
    this.stateAction.addEventListener('click', () => this.onOpenSettings());
    this.taskButtons.forEach((button) => button.addEventListener('click', () => {
      this.setView('task');
      const label = button.querySelector('strong')?.textContent || '任务';
      if (button.dataset.runtimeTest) this.executeRuntimeTest(button.dataset.runtimeTest, label, button);
      else this.execute(button.dataset.prompt, label, button, button.dataset.demo || null);
    }));
    this.commandForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      const value = this.commandInput.value.trim();
      if (!value || this.busy) return;
      this.commandInput.value = '';
      this.setView('task');
      await this.execute(value, value.length > 54 ? `${value.slice(0, 54)}…` : value);
    });
  }

  attachAgent({ agent, gateway }) {
    this.agent = agent;
    this.gateway = gateway;
    this.setAvailability(gateway?.isConfigured?.() ?? true);
  }

  setOpenSettingsHandler(handler) {
    this.onOpenSettings = handler || (() => {});
  }

  setAvailability(available) {
    this.available = Boolean(available);
    if (!this.busy) {
      if (this.available) this.setState('ready', '就绪', '选择常用任务，或在下方描述你自己的目标。');
      else this.setState('offline', 'LLM Agent 未连接', 'Runtime 验收仍可直接运行；自然语言任务需要配置 Agent Gateway。', { action: '配置' });
    }
    this.updateControls();
  }

  setState(state, label, detail, { action = null } = {}) {
    this.state.dataset.state = state;
    this.stateLabel.textContent = label;
    this.stateDetail.textContent = detail;
    this.stateAction.textContent = action || '';
    this.stateAction.classList.toggle('hidden', !action);
  }

  updateControls() {
    for (const button of this.taskButtons) button.disabled = this.busy || (!button.dataset.runtimeTest && !this.available);
    this.commandInput.disabled = !this.available;
    this.commandInput.readOnly = this.busy;
    this.commandButton.disabled = this.busy || !this.available;
    this.commandButtonLabel.textContent = this.busy ? '执行中…' : '执行任务';
    this.state.setAttribute('aria-busy', this.busy ? 'true' : 'false');
  }

  setBusy(busy, sourceButton = null) {
    this.busy = busy;
    this.consoleEl?.classList.toggle('is-executing', busy);
    this.activeTaskButton?.classList.remove('is-running');
    this.activeTaskButton = busy ? sourceButton : null;
    this.activeTaskButton?.classList.add('is-running');
    this.updateControls();
  }

  beginJourney(intent, label = '任务', source = null) {
    this.journey = createAgentJourney(intent, label);
    this.journeySource = source;
    this.renderJourney();
    return this.journey;
  }

  observeAgentTool(event) {
    if (!this.busy || !this.journey) return;
    if (this.journeySource && event?.source !== this.journeySource) return;
    this.journey = addAgentTool(this.journey, event);
    this.renderJourney();
  }

  observeAgentSequence(event) {
    if (!this.busy || !this.journey) return;
    if (this.journeySource && event?.source !== this.journeySource) return;
    this.journey = applyAgentSequence(this.journey, event);
    this.renderJourney();
  }

  finishJourney({ result = null, status = 'success', detail = '' } = {}) {
    if (!this.journey) return null;
    this.journey = finalizeAgentJourney(this.journey, { result, status, detail });
    this.renderJourney();
    return structuredClone(this.journey);
  }

  renderJourney() {
    const journey = this.journey;
    if (!this.journeyEl) return;
    this.journeyEl.dataset.state = journey?.state || 'idle';
    this.intentEl.textContent = journey?.intent || '等待一个目标。';

    const actionError = journey?.actions?.some((entry) => entry.state === 'error');
    const changeError = journey?.changes?.some((entry) => entry.state === 'error');
    this.journeyStages.intent.dataset.state = journey ? 'success' : 'idle';
    this.journeyStages.actions.dataset.state = !journey ? 'idle'
      : journey.state === 'running' ? 'running'
        : actionError ? 'error'
          : journey.actions.length ? 'success' : 'idle';
    this.journeyStages.changes.dataset.state = !journey ? 'idle'
      : journey.state === 'running' && !journey.changes.length ? 'waiting'
        : changeError ? 'error'
          : journey.changes.length ? 'success' : 'idle';
    this.journeyStages.result.dataset.state = journey?.result?.state || 'idle';

    this.actionsEl.replaceChildren();
    if (!journey?.actions?.length) {
      const empty = document.createElement('p');
      empty.textContent = journey?.state === 'running' ? '正在理解目标并规划下一步…' : 'Agent 的执行步骤会显示在这里。';
      this.actionsEl.append(empty);
    } else {
      for (const entry of journey.actions) {
        this.actionsEl.append(this.journeyRow(entry.label, entry.state, outcomeLabel(entry.outcome)));
      }
    }

    this.changesEl.replaceChildren();
    if (!journey?.changes?.length) {
      const empty = document.createElement('p');
      empty.textContent = journey?.state === 'running'
        ? '等待第一个经过 Runtime 验证的世界变化…'
        : '本次任务没有已确认的世界变化。';
      this.changesEl.append(empty);
    } else {
      for (const entry of journey.changes) {
        this.changesEl.append(this.journeyRow(entry.label, entry.state, entry.detail));
      }
    }

    this.resultLabelEl.textContent = journey?.result?.label || '等待执行';
    this.resultDetailEl.textContent = journey?.result?.detail || '完成后会明确显示成功、部分完成或失败。';
  }

  journeyRow(label, state = 'done', detail = '') {
    const row = document.createElement('div');
    row.className = 'agent-stage-row';
    row.dataset.state = state;
    const marker = document.createElement('span');
    marker.className = 'agent-stage-marker';
    marker.textContent = state === 'success' ? '✓' : state === 'error' ? '!' : state === 'skipped' ? '–' : '•';
    const copy = document.createElement('div');
    const strong = document.createElement('strong');
    strong.textContent = label;
    copy.append(strong);
    if (detail && detail !== '状态未知') {
      const small = document.createElement('small');
      small.textContent = detail;
      copy.append(small);
    }
    row.append(marker, copy);
    return row;
  }

  log(text, kind = '') {
    const row = document.createElement('div');
    row.className = `log-row ${kind}`;
    row.textContent = text;
    this.logEl.append(row);
    while (this.logEl.children.length > 80) this.logEl.firstElementChild.remove();
    if (this.activityPanel.open) {
      this.activityCount = 0;
      this.activityCountEl.textContent = '0';
      this.logEl.scrollTop = this.logEl.scrollHeight;
    } else {
      this.activityCount += 1;
      this.activityCountEl.textContent = String(Math.min(this.activityCount, 99));
    }
  }


  recordRun(run) {
    try {
      this.onRun(run);
    } catch (error) {
      try { this.log(`执行记录错误：${error?.message || '未知错误'}`, 'error'); } catch {}
    }
  }

  async executeRuntimeTest(testId, label = 'Runtime 验收', sourceButton = null) {
    if (this.busy) return null;
    if (!this.runtimeTestRunner) {
      this.setState('error', 'Runtime 测试不可用', 'Agent Runtime Test Runner 未配置。');
      return null;
    }
    const startedAt = performance.now();
    const runId = `runtime_${Date.now().toString(36)}`;
    this.beginJourney(label, `Runtime · ${label}`, 'runtime-test');
    this.setBusy(true, sourceButton);
    this.setState('running', '正在执行 Runtime 验收', label);
    try {
      const result = await this.runtimeTestRunner.run(testId);
      this.setState('success', 'Runtime 验收通过', `${label} · 不依赖 LLM。`);
      this.log(`Runtime 验收通过：${label}`, 'result');
      const journey = this.finishJourney({ result, status:'success', detail:'确定性 Runtime 工具链验证通过。' });
      this.recordRun({ id:runId, title:`Runtime · ${label}`, prompt:testId, status:'success', durationMs:performance.now()-startedAt, detail:journeyRunDetail(journey), journey });
      return result;
    } catch (error) {
      this.setState('error', 'Runtime 验收失败', error.message);
      this.log(`Runtime 验收失败：${error.message}`, 'error');
      const journey = this.finishJourney({ status:'error', detail:error.message });
      this.recordRun({ id:runId, title:`Runtime · ${label}`, prompt:testId, status:'error', durationMs:performance.now()-startedAt, detail:journeyRunDetail(journey), journey });
      return null;
    } finally {
      this.setBusy(false);
    }
  }

  async execute(prompt, label = '任务', sourceButton = null, demoId = null) {
    if (this.busy) return null;
    if (!this.available || !this.agent) {
      this.setState('offline', '智能体不可用', '智能体能力当前不可用；由部署适配器提供，无需在浏览器填写地址。', { action: '配置' });
      return null;
    }

    const startedAt = performance.now();
    const runId = `run_${Date.now().toString(36)}`;
    this.beginJourney(prompt, label, demoId ? null : 'agent');
    this.setBusy(true, sourceButton);
    this.setState('running', '正在执行任务', label);

    try {
      const demoRunner = demoId ? this.demoRunners?.[demoId] : null;
      const result = demoRunner ? await demoRunner.run(GENERATED_PLACEMENT_TASK) : await this.agent.run(prompt);
      const completed = result.taskStatus === 'completed' || result.status === 'completed';
      const tool = result.lastMutation?.tool || 'mutation';
      const outcome = result.lastMutation?.outcome?.state || 'unknown';
      if (completed) {
        this.setState('success', '任务已完成', `${label} · 运行时验证通过。`);
        this.log('任务状态：已完成 · 变更链已验证', 'result');
      } else {
        this.setState('partial', '任务部分完成', `${label} · ${tool} → ${outcome}`);
        this.log(`任务状态：未完成 · ${tool} → ${outcome}`, 'error');
      }
      const status = completed ? 'success' : 'partial';
      const detail = completed ? (result.message || '运行时验证通过。') : `${tool} → ${outcome}`;
      const journey = this.finishJourney({ result, status, detail });
      this.recordRun({ id:runId, title:label, prompt, status, durationMs:performance.now()-startedAt, detail:journeyRunDetail(journey), journey });
      return result;
    } catch (error) {
      this.setState('error', '任务执行失败', error.message);
      this.log(`错误：${error.message}`, 'error');
      const journey = this.finishJourney({ status:'error', detail:error.message });
      this.recordRun({ id:runId, title:label, prompt, status:'error', durationMs:performance.now()-startedAt, detail:journeyRunDetail(journey), journey });
      return null;
    } finally {
      this.setBusy(false);
    }
  }
}
