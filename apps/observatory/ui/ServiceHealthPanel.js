import { SERVICE_LABELS, STATE_LABELS, describeReason, summarize } from '../app/ServiceHealthMonitor.js';

const escapeHtml = (value) => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');

export function renderServiceHealthMarkup() {
  return `
    <div class="obs-health" data-health-root>
      <button class="obs-health-trigger" type="button" aria-haspopup="true" aria-expanded="false" aria-controls="obs-health-popover" data-health-trigger>
        <i class="obs-health-dot" data-state="unknown" aria-hidden="true"></i>
        <span data-health-summary>服务检测中</span>
      </button>
      <div id="obs-health-popover" class="obs-health-popover obs-glass-elevated" role="region" aria-label="后端服务状态" hidden>
        <header>
          <strong>后端服务</strong>
          <button type="button" class="obs-health-refresh" data-health-refresh>重新检测</button>
        </header>
        <ul data-health-list></ul>
        <p class="obs-health-note" data-health-note>每 15 秒自动检测一次，页面隐藏时暂停。</p>
      </div>
      <span class="obs-sr-only" role="status" aria-live="polite" data-health-live></span>
    </div>`;
}

function rowMarkup(service) {
  const label = SERVICE_LABELS[service.id];
  const state = STATE_LABELS[service.state];
  const reason = describeReason(service.reason);
  const latency = service.latencyMs == null ? '' : `<span class="ds-num">${service.latencyMs} ms</span>`;
  return `
    <li data-state="${escapeHtml(service.state)}">
      <i class="obs-health-dot" data-state="${escapeHtml(service.state)}" aria-hidden="true"></i>
      <div>
        <b>${escapeHtml(label.title)}</b>
        <small>${escapeHtml(reason || label.hint)}</small>
      </div>
      <div class="obs-health-meta"><strong>${escapeHtml(state)}</strong>${latency}</div>
    </li>`;
}

export function mountServiceHealthPanel(host) {
  const root = host.querySelector('[data-health-root]');
  const trigger = root.querySelector('[data-health-trigger]');
  const popover = root.querySelector('.obs-health-popover');
  const summary = root.querySelector('[data-health-summary]');
  const list = root.querySelector('[data-health-list]');
  const dot = trigger.querySelector('.obs-health-dot');
  const live = root.querySelector('[data-health-live]');
  const refreshButton = root.querySelector('[data-health-refresh]');
  let previous = 'unknown';
  let onRefresh = null;

  const setOpen = (open) => {
    popover.hidden = !open;
    trigger.setAttribute('aria-expanded', String(open));
  };

  trigger.addEventListener('click', () => setOpen(popover.hidden));
  refreshButton.addEventListener('click', async () => {
    refreshButton.disabled = true;
    refreshButton.textContent = '检测中…';
    try { await onRefresh?.(); } finally {
      refreshButton.disabled = false;
      refreshButton.textContent = '重新检测';
    }
  });
  document.addEventListener('pointerdown', (event) => { if (!popover.hidden && !root.contains(event.target)) setOpen(false); });
  root.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !popover.hidden) { setOpen(false); trigger.focus(); }
  });

  return {
    onRefresh(handler) { onRefresh = handler; },
    render(services) {
      const state = summarize(services);
      dot.dataset.state = state;
      summary.textContent = state === 'ok' ? '服务正常' : state === 'slow' ? '服务较慢' : state === 'down' || state === 'offline' ? '服务异常' : state === 'unconfigured' ? '部分未配置' : '服务检测中';
      list.innerHTML = Object.values(services).map(rowMarkup).join('');
      // Announce only real transitions so assistive tech is not spammed by each poll.
      if (state !== previous && previous !== 'unknown') live.textContent = `后端服务状态变为：${summary.textContent}`;
      previous = state;
    }
  };
}
