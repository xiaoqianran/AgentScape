// Polls the same-origin capability health API and exposes a small observable state.
// Browser code must never import apps/server; it only sees the sanitized JSON contract.

export const HEALTH_API = '/api/capabilities/health';

export const SERVICE_LABELS = Object.freeze({
  agent: { title: '智能体网关', hint: 'LLM 工具调用代理' },
  'asset.compile': { title: '资产编译器', hint: '碰撞体与物理属性编译' }
});

export const STATE_LABELS = Object.freeze({
  ok: '正常',
  slow: '响应慢',
  down: '不可用',
  unconfigured: '未配置',
  unknown: '检测中',
  offline: '无法检测'
});

const REASON_LABELS = Object.freeze({
  NOT_CONFIGURED: '部署环境未配置该服务',
  TIMEOUT: '健康检查超时',
  UNREACHABLE: '无法连接上游服务',
  HTTP_401: '上游拒绝认证',
  HTTP_403: '上游拒绝访问',
  HTTP_404: '上游缺少 /health 端点',
  HTTP_500: '上游内部错误',
  HTTP_502: '上游网关错误',
  HTTP_503: '上游暂不可用',
  HTTP_504: '上游网关超时',
  API_UNAVAILABLE: '健康检查接口不可用'
});

export function describeReason(reason) {
  if (!reason) return '';
  return REASON_LABELS[reason] || (String(reason).startsWith('HTTP_') ? `上游返回 ${String(reason).slice(5)}` : '未知原因');
}

export function normalizeHealth(payload) {
  const source = payload?.capabilities;
  const services = {};
  for (const id of Object.keys(SERVICE_LABELS)) {
    const item = source?.[id];
    const state = ['ok', 'slow', 'down', 'unconfigured'].includes(item?.state) ? item.state : 'unknown';
    services[id] = {
      id,
      state,
      latencyMs: Number.isFinite(item?.latencyMs) ? Math.round(item.latencyMs) : null,
      reason: typeof item?.reason === 'string' ? item.reason : null,
      checkedAt: typeof item?.checkedAt === 'string' ? item.checkedAt : null
    };
  }
  return services;
}

export function offlineHealth(reason = 'API_UNAVAILABLE') {
  return Object.fromEntries(Object.keys(SERVICE_LABELS).map((id) => [
    id,
    { id, state: 'offline', latencyMs: null, reason, checkedAt: null }
  ]));
}

// Worst state wins for the single summary dot.
const SEVERITY = { ok: 0, unconfigured: 1, unknown: 1, slow: 2, offline: 3, down: 3 };
export function summarize(services) {
  const list = Object.values(services);
  if (!list.length) return 'unknown';
  return list.reduce((worst, item) => (SEVERITY[item.state] > SEVERITY[worst] ? item.state : worst), 'ok');
}

export class ServiceHealthMonitor {
  constructor({ fetchImpl = (...args) => fetch(...args), intervalMs = 15_000, timeoutMs = 6_000, onChange, documentRef = globalThis.document } = {}) {
    this.documentRef = documentRef ?? null;
    this.fetchImpl = fetchImpl;
    this.intervalMs = intervalMs;
    this.timeoutMs = timeoutMs;
    this.onChange = onChange;
    this.services = Object.fromEntries(Object.keys(SERVICE_LABELS).map((id) => [
      id,
      { id, state: 'unknown', latencyMs: null, reason: null, checkedAt: null }
    ]));
    this.timer = null;
    this.inflight = null;
    this.stopped = true;
    this.onVisibility = () => {
      if (this.stopped) return;
      if (this.documentRef?.hidden) this.#clearTimer();
      else this.refresh();
    };
  }

  start() {
    if (!this.stopped) return;
    this.stopped = false;
    this.documentRef?.addEventListener('visibilitychange', this.onVisibility);
    this.refresh();
  }

  stop() {
    this.stopped = true;
    this.documentRef?.removeEventListener('visibilitychange', this.onVisibility);
    this.#clearTimer();
  }

  // Concurrent callers share one request, so rapid clicks never stack probes.
  refresh() {
    if (this.inflight) return this.inflight;
    this.#clearTimer();
    this.inflight = this.#probe().finally(() => {
      this.inflight = null;
      if (!this.stopped && !this.documentRef?.hidden) this.timer = setTimeout(() => this.refresh(), this.intervalMs);
    });
    return this.inflight;
  }

  async #probe() {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(HEALTH_API, {
        method: 'GET',
        headers: { accept: 'application/json' },
        cache: 'no-store',
        signal: controller.signal
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      this.#set(normalizeHealth(await response.json()));
    } catch {
      this.#set(offlineHealth(controller.signal.aborted ? 'TIMEOUT' : 'API_UNAVAILABLE'));
    } finally {
      clearTimeout(timer);
    }
  }

  #set(services) {
    this.services = services;
    if (!this.stopped) this.onChange?.(services);
  }

  #clearTimer() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }
}
