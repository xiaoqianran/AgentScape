const QUICK_TASK_GROUPS = [
  {
    label: 'Common tasks',
    tasks: [
      { title: 'Pick up the cup', detail: 'Walk to the cup and pick it up safely', prompt: '让 agent_01 走到 cup_01 前并拿起杯子' },
      { title: 'Put cup on table', detail: 'Place the cup on the table and verify stability', prompt: '让 agent_01 先拿起 cup_01，再把它放到 table_01 上并确认稳定' },
      { title: 'Open cabinet', detail: 'Walk to the cabinet and verify it opened', prompt: '让 agent_01 走到 cabinet_01 前并打开柜门' },
      { title: 'Drop held object', detail: 'Release the currently held object', prompt: '让 agent_01 放下当前拿着的物体' }
    ]
  },
  {
    label: 'Workflows',
    tasks: [
      { title: 'Complete embodied task', detail: 'Open → pick → place → verify', prompt: '让 agent_01 打开 cabinet_01，确认柜门完成打开后拿起 cup_01，再把杯子放到 table_01 上；每一步失败都不要继续后续动作', wide: true },
      { title: 'Build a coffee corner', detail: 'Let the Agent plan the scene workflow', prompt: '建立一个咖啡角', wide: true }
    ]
  }
];

const escapeAttr = (value) => String(value).replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;');

const quickTaskMarkup = () => QUICK_TASK_GROUPS.map((group) => `
  <section class="task-group">
    <div class="section-label">${group.label}</div>
    <div class="task-grid">
      ${group.tasks.map((task) => `<button class="task-card${task.wide ? ' wide' : ''}" type="button" data-prompt="${escapeAttr(task.prompt)}"><strong>${task.title}</strong><span>${task.detail}</span></button>`).join('')}
    </div>
  </section>`).join('');

export const taskPanelMarkup = () => `
  <section class="task-console" aria-label="Task">
    <header class="screen-heading">
      <div class="eyebrow">Task</div>
      <h1>Make something happen</h1>
      <p>Describe the outcome. AgentScape will plan, act, and verify the world state.</p>
    </header>

    <div id="task-state" class="task-state" data-state="ready" role="status" aria-live="polite">
      <span class="task-state-dot"></span>
      <div class="task-state-copy">
        <strong id="task-state-label">Ready</strong>
        <span id="task-state-detail">Use a common task or describe your own below.</span>
      </div>
      <button id="task-state-action" class="text-button hidden" type="button">Configure</button>
    </div>

    <div class="task-scroll">
      <div class="quick-tasks">${quickTaskMarkup()}</div>
      <details class="activity-panel">
        <summary><span>Run details</span><small id="activity-count">0</small></summary>
        <div id="log" class="log" aria-label="Task activity log"></div>
      </details>
    </div>
  </section>`;

export class TaskPanel {
  constructor({ root, commandForm, commandInput, commandButton, setView, onRun = () => {}, onOpenSettings = () => {} }) {
    this.root = root;
    this.commandForm = commandForm;
    this.commandInput = commandInput;
    this.commandButton = commandButton;
    this.commandButtonLabel = commandButton.querySelector('span');
    this.setView = setView;
    this.onRun = onRun;
    this.onOpenSettings = onOpenSettings;
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
      this.execute(button.dataset.prompt, button.querySelector('strong')?.textContent || 'Task', button);
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
      if (this.available) this.setState('ready', 'Ready', 'Use a common task or describe your own below.');
      else this.setState('offline', 'Agent unavailable', 'Configure an LLM Gateway to run Agent tasks.', { action: 'Configure' });
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
    this.commandButtonLabel.textContent = this.busy ? 'Running…' : 'Run Task';
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
      try { this.log(`run history error: ${error?.message || 'unknown error'}`, 'error'); } catch {}
    }
  }

  async execute(prompt, label = 'Task', sourceButton = null) {
    if (this.busy) return null;
    if (!this.available || !this.agent) {
      this.setState('offline', 'Agent unavailable', 'Configure an LLM Gateway to run Agent tasks.', { action: 'Configure' });
      return null;
    }

    const startedAt = performance.now();
    const runId = `run_${Date.now().toString(36)}`;
    this.setBusy(true, sourceButton);
    this.setState('running', 'Running task', label);

    try {
      const result = await this.agent.run(prompt);
      const completed = result.taskStatus === 'completed';
      const tool = result.lastMutation?.tool || 'mutation';
      const outcome = result.lastMutation?.outcome?.state || 'unknown';
      if (completed) {
        this.setState('success', 'Task completed', `${label} · Runtime verification passed.`);
        this.log('task status: completed · mutation chain verified', 'result');
      } else {
        this.setState('partial', 'Partially completed', `${label} · ${tool} → ${outcome}`);
        this.log(`task status: incomplete · ${tool} → ${outcome}`, 'error');
      }
      this.recordRun({ id: runId, title: label, prompt, status: completed ? 'success' : 'partial', durationMs: performance.now() - startedAt, detail: completed ? 'Runtime verification passed.' : `${tool} → ${outcome}` });
      return result;
    } catch (error) {
      this.setState('error', 'Task failed', error.message);
      this.log(`error: ${error.message}`, 'error');
      this.recordRun({ id: runId, title: label, prompt, status: 'error', durationMs: performance.now() - startedAt, detail: error.message });
      return null;
    } finally {
      this.setBusy(false);
    }
  }
}
