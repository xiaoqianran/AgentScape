const STATUS_LABELS = {
  success: ['Completed', '✓'],
  partial: ['Partial', '!'],
  error: ['Failed', '×'],
  cancelled: ['Cancelled', '–']
};

export const runsPanelMarkup = () => `
  <section class="runs-console" aria-label="Runs">
    <header class="screen-heading split-heading">
      <div>
        <div class="eyebrow">Runs</div>
        <h1>Review task history</h1>
        <p>See what happened in this browser session and where a task stopped.</p>
      </div>
      <label class="compact-filter">Status
        <select id="runs-filter">
          <option value="all">All</option>
          <option value="success">Completed</option>
          <option value="partial">Partial</option>
          <option value="error">Failed</option>
        </select>
      </label>
    </header>

    <div class="runs-scroll">
      <div id="runs-empty" class="empty-state">
        <strong>No runs yet</strong>
        <span>Completed, partial, and failed Agent tasks will appear here.</span>
      </div>
      <div id="runs-table-wrap" class="runs-table-wrap hidden">
        <table class="runs-table">
          <thead><tr><th>Status</th><th>Task</th><th>Time</th></tr></thead>
          <tbody id="runs-body"></tbody>
        </table>
      </div>
      <section id="run-detail" class="run-detail hidden" aria-live="polite"></section>
    </div>
  </section>`;

export class RunsPanel {
  constructor({ root }) {
    this.root = root;
    this.runs = [];
    this.filter = root.querySelector('#runs-filter');
    this.empty = root.querySelector('#runs-empty');
    this.tableWrap = root.querySelector('#runs-table-wrap');
    this.body = root.querySelector('#runs-body');
    this.detail = root.querySelector('#run-detail');
    this.filter.addEventListener('change', () => this.render());
  }

  addRun(run) {
    this.runs.unshift({ ...run, createdAt: Date.now() });
    this.runs = this.runs.slice(0, 50);
    this.render();
  }

  render() {
    const filter = this.filter.value;
    const visible = filter === 'all' ? this.runs : this.runs.filter((run) => run.status === filter);
    this.body.replaceChildren();
    this.empty.classList.toggle('hidden', visible.length > 0);
    this.tableWrap.classList.toggle('hidden', visible.length === 0);
    if (!visible.length) {
      this.detail.classList.add('hidden');
      return;
    }

    for (const run of visible) {
      const row = document.createElement('tr');
      row.tabIndex = 0;
      row.setAttribute('role', 'button');
      const [label, icon] = STATUS_LABELS[run.status] || [run.status, '•'];
      const status = document.createElement('td');
      status.innerHTML = `<span class="run-status" data-state="${run.status}"><i>${icon}</i>${label}</span>`;
      const title = document.createElement('td');
      title.textContent = run.title;
      title.title = run.title;
      const time = document.createElement('td');
      time.textContent = formatDuration(run.durationMs);
      row.append(status, title, time);
      const select = () => this.renderDetail(run);
      row.addEventListener('click', select);
      row.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); select(); }
      });
      this.body.append(row);
    }
  }

  renderDetail(run) {
    this.detail.replaceChildren();
    this.detail.classList.remove('hidden');
    const heading = document.createElement('div');
    heading.className = 'run-detail-heading';
    const title = document.createElement('strong');
    title.textContent = run.title;
    const duration = document.createElement('span');
    duration.textContent = formatDuration(run.durationMs);
    heading.append(title, duration);
    const detail = document.createElement('p');
    detail.textContent = run.detail || 'No additional detail.';
    const prompt = document.createElement('details');
    prompt.className = 'disclosure';
    prompt.innerHTML = '<summary>Original task</summary>';
    const code = document.createElement('div');
    code.className = 'run-prompt';
    code.textContent = run.prompt;
    prompt.append(code);
    this.detail.append(heading, detail, prompt);
  }
}

function formatDuration(ms = 0) {
  if (ms < 1000) return `${Math.round(ms)} ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(ms < 10000 ? 1 : 0)} s`;
  return `${Math.floor(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s`;
}
