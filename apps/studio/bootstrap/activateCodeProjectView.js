/** 同步切换代码世界显示，任何 UI 回调失败都还原先前状态。 */
export function activateCodeProjectView({ session, projectHost, viewport, runtimeDriver, liveBridge, baseScene, baseWorld, ui }) {
  const previous = {
    hidden:projectHost.hidden,
    classActive:viewport.classList.contains('has-code-project'),
    running:runtimeDriver.running,
    scene:liveBridge.scene,
    world:liveBridge.world,
    selection:ui.getSelection?.() ?? null
  };
  try {
    projectHost.hidden = !session;
    viewport.classList.toggle('has-code-project', Boolean(session));
    if (session) runtimeDriver.stop();
    else runtimeDriver.start();
    liveBridge.scene = session?.scene || baseScene;
    liveBridge.world = session?.world || baseWorld;
    ui.setSelection?.(null);
    ui.refreshInspector?.();
  } catch (error) {
    // 回滚显示与数据引用，避免 Bridge 指向已失效的 World。
    projectHost.hidden = previous.hidden;
    viewport.classList.toggle('has-code-project', previous.classActive);
    liveBridge.scene = previous.scene;
    liveBridge.world = previous.world;
    if (previous.running && !runtimeDriver.running) runtimeDriver.start();
    else if (!previous.running && runtimeDriver.running) runtimeDriver.stop();
    try { ui.setSelection?.(previous.selection); } catch { /* 保留原始异常 */ }
    throw error;
  }
}
