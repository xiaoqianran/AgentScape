export const STATUS_LABELS = Object.freeze({
  success:['已完成','✓'],
  partial:['部分完成','!'],
  error:['失败','×'],
  cancelled:['已取消','–']
});

export function formatDuration(ms = 0) {
  if (ms < 1000) return `${Math.round(ms)} 毫秒`;
  if (ms < 60000) return `${(ms / 1000).toFixed(ms < 10000 ? 1 : 0)} 秒`;
  return `${Math.floor(ms / 60000)} 分 ${Math.round((ms % 60000) / 1000)} 秒`;
}
