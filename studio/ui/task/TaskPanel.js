import { generatedPlacementDemoTask } from '../../demos/generated-placement/index.js';

const GENERATED_PLACEMENT_TASK = generatedPlacementDemoTask();

const QUICK_TASK_GROUPS = [
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
      ${group.tasks.map((task) => `<button class="task-card${task.wide ? ' wide' : ''}" type="button" data-prompt="${escapeAttr(task.prompt)}"${task.demo ? ` data-demo="${escapeAttr(task.demo)}"` : ''}><strong>${task.title}</strong><span>${task.detail}</span></button>`).join('')}
    </div>
  </section>`).join('');

export const taskPanelMarkup = () => `
  <section class="task-console" aria-label="任务">
    <header class="screen-heading">
      <div class="eyebrow">任务</div>
      <h1>让世界发生变化</h1>
      <p>描述目标结果，AgentScape 会规划、执行并验证世界状态。</p>
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
      <div class="quick-tasks">${quickTaskMarkup()}</div>
      <details class="activity-panel">
        <summary><span>执行详情</span><small id="activity-count">0</small></summary>
        <div id="log" class="log" aria-label="任务活动日志"></div>
      </details>
    </div>
  </section>`;

export class TaskPanel {
  constructor({ root, commandForm, commandInput, commandButton, setView, onRun = () => {}, onOpenSettings = () => {}, demoRunners = {} }) {
    this.root = root;
    this.commandForm = commandForm;
    this.commandInput = commandInput;
    this.commandButton = commandButton;
    this.commandButtonLabel = commandButton.querySelector('span');
    this.setView = setView;
    this.onRun = onRun;
    this.onOpenSettings = onOpenSettings;
    this.demoRunners = demoRunners;
    this.agent = null;
    this.gateway = null;
    this.busy = false;
    this.available = true;
    this.activeTaskButton = null;
    this.activityCount = 0;

    const q = (selector) => root.querySelector(selector);
    this.state = q('#task-state');
    this.stateLabel = q('#task-state-label');
    this.stateDetail = q('#task-state-detail');
    this.stateAction = q('#task-state-action');
    this.logEl = q('#log');
    this.activityPanel = q('.activity-panel');
    this.activityCountEl = q('#activity-count');
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
      this.execute(button.dataset.prompt, button.querySelector('strong')?.textContent || '任务', button, button.dataset.demo || null);
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
      else this.setState('offline', '智能体不可用', '智能体能力当前不可用；由部署适配器提供，无需在浏览器填写地址。', { action: '配置' });
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
    for (const button of this.taskButtons) button.disabled = this.busy || !this.available;
    this.commandInput.disabled = !this.available;
    this.commandInput.readOnly = this.busy;
    this.commandButton.disabled = this.busy || !this.available;
    this.commandButtonLabel.textContent = this.busy ? '执行中…' : '执行任务';
    this.state.setAttribute('aria-busy', this.busy ? 'true' : 'false');
  }

  setBusy(busy, sourceButton = null) {
    this.busy = busy;
    this.activeTaskButton?.classList.remove('is-running');
    this.activeTaskButton = busy ? sourceButton : null;
    this.activeTaskButton?.classList.add('is-running');
    this.updateControls();
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

  async execute(prompt, label = '任务', sourceButton = null, demoId = null) {
    if (this.busy) return null;
    if (!this.available || !this.agent) {
      this.setState('offline', '智能体不可用', '智能体能力当前不可用；由部署适配器提供，无需在浏览器填写地址。', { action: '配置' });
      return null;
    }

    const startedAt = performance.now();
    const runId = `run_${Date.now().toString(36)}`;
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
      this.recordRun({ id: runId, title: label, prompt, status: completed ? 'success' : 'partial', durationMs: performance.now() - startedAt, detail: completed ? '运行时验证通过。' : `${tool} → ${outcome}` });
      return result;
    } catch (error) {
      this.setState('error', '任务执行失败', error.message);
      this.log(`错误：${error.message}`, 'error');
      this.recordRun({ id: runId, title: label, prompt, status: 'error', durationMs: performance.now() - startedAt, detail: error.message });
      return null;
    } finally {
      this.setBusy(false);
    }
  }
}
