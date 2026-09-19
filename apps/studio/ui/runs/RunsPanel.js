export const STATUS_LABELS = Object.freeze({
  success:['已完成','✓'],
  partial:['部分完成','!'],
  error:['失败','×'],
  cancelled:['已取消','–']
});

export class RunsPanel {
  constructor() {
    this.runs = [];
    this.listeners = new Set();
    this.viewSnapshot = Object.freeze({ runs:this.runs });
  }

  subscribe = (listener) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  snapshot = () => this.viewSnapshot;

  emit() {
    this.viewSnapshot = Object.freeze({ runs:this.runs });
    for (const listener of this.listeners) listener();
  }

  addRun(run) {
    this.runs = [{ ...run, createdAt:Date.now() }, ...this.runs].slice(0,50);
    this.emit();
  }

  dispose() {
    this.listeners.clear();
  }
}

export function formatDuration(ms = 0) {
  if (ms < 1000) return `${Math.round(ms)} 毫秒`;
  if (ms < 60000) return `${(ms / 1000).toFixed(ms < 10000 ? 1 : 0)} 秒`;
  return `${Math.floor(ms / 60000)} 分 ${Math.round((ms % 60000) / 1000)} 秒`;
}
