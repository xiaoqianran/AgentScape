const STATUS_LABELS = {
  success: ['已完成', '✓'],
  partial: ['部分完成', '!'],
  error: ['失败', '×'],
  cancelled: ['已取消', '–']
};

export const runsPanelMarkup = () => `
  <section class="runs-console" aria-label="执行记录">
    <header class="screen-heading split-heading">
      <div>
        <div class="eyebrow">执行记录</div>
        <h1>查看任务历史</h1>
        <p>查看本次浏览器会话中任务发生了什么，以及任务停在了哪里。</p>
      </div>
      <label class="compact-filter">状态
        <select id="runs-filter">
          <option value="all">全部</option>
          <option value="success">已完成</option>
          <option value="partial">部分完成</option>
          <option value="error">失败</option>
          <option value="cancelled">已取消</option>
        </select>
      </label>
    </header>

    <div class="runs-scroll">
      <div id="runs-empty" class="empty-state">
        <strong>暂无执行记录</strong>
        <span>已完成、部分完成、失败和取消的智能体任务会显示在这里。</span>
      </div>
      <div id="runs-table-wrap" class="runs-table-wrap hidden">
        <table class="runs-table">
          <thead><tr><th>状态</th><th>任务</th><th>耗时</th></tr></thead>
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
      const statusBadge = document.createElement('span');
      statusBadge.className = 'run-status';
      statusBadge.dataset.state = run.status;
      const statusIcon = document.createElement('i');
      statusIcon.textContent = icon;
      statusBadge.append(statusIcon, document.createTextNode(label));
      status.append(statusBadge);
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
    detail.textContent = run.detail || '暂无更多详情。';
    const prompt = document.createElement('details');
    prompt.className = 'disclosure';
    const summary = document.createElement('summary');
    summary.textContent = '原始任务';
    prompt.append(summary);
    const code = document.createElement('div');
    code.className = 'run-prompt';
    code.textContent = run.prompt;
    prompt.append(code);
    this.detail.append(heading, detail, prompt);
  }
}

function formatDuration(ms = 0) {
  if (ms < 1000) return `${Math.round(ms)} 毫秒`;
  if (ms < 60000) return `${(ms / 1000).toFixed(ms < 10000 ? 1 : 0)} 秒`;
  return `${Math.floor(ms / 60000)} 分 ${Math.round((ms % 60000) / 1000)} 秒`;
}
