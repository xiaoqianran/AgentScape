/** 合并同一事件批次的场景刷新，卸载后不再更新 React 状态。 */
export function subscribeSceneRefresh(events, types, refresh, schedule = queueMicrotask) {
  let active = true;
  let pending = false;
  const onChange = () => {
    if (!active || pending) return;
    pending = true;
    schedule(() => {
      pending = false;
      if (active) refresh();
    });
  };
  const unsubscribers = types.map(type => events.on(type, onChange));
  return () => {
    active = false;
    for (const unsubscribe of unsubscribers) unsubscribe?.();
  };
}
