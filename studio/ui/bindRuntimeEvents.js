export function bindRuntimeEvents({ world, editor, inspector, taskPanel, ui, autosave = null, reload = () => location.reload() }) {
  const log = (text, kind) => taskPanel.log(text, kind);
  world.events.on('renderer.device-lost', ({ api, reason, message }) => {
    let saved = false;
    try {
      saved = Boolean(autosave?.flush?.());
    } catch (error) {
      log(`渲染中断后的自动保存失败：${error.message}`, 'error');
    }
    const backend = api || 'GPU';
    ui.setRuntimeStatus('error', '渲染已中断 · 点击恢复');
    ui.setRuntimeRecoveryAction?.(reload, '渲染已中断 · 点击恢复');
    log(`渲染设备丢失：${backend} · ${reason || 'unknown'} · ${message || 'unknown'}${saved ? ' · 场景已保存' : ''}`, 'error');
  });
  world.events.on('renderer.error', ({ type, message }) => log(`渲染错误：${type || 'GPUError'} · ${message || 'unknown'}`, 'error'));
  world.events.on('tool.called', (event) => log(`工具：${event.name} ${JSON.stringify(event.args)}`, 'tool'));
  world.events.on('interaction', (event) => log(`动作：${event.action} ${event.id}`, 'tool'));
  world.events.on('locomotion.started', ({ id, waypoints, pathCost }) => log(`行走：${id} · ${waypoints} 个路径点 · ${pathCost ?? '?'} 米`, 'tool'));
  world.events.on('locomotion.arrived', ({ id, elapsed }) => log(`已到达：${id} · ${elapsed} 秒`, 'result'));
  world.events.on('locomotion.blocked', ({ id, reason }) => log(`受阻：${id} · ${reason}`, 'error'));
  world.events.on('editor.selection', ({ id }) => {
    inspector.render(id);
    if (id) ui.setView('inspect');
  });
  world.events.on('editor.transform', ({ id }) => inspector.render(id));
  world.events.on('object.removed', ({ id }) => {
    if (editor.selectedId === id) editor.select(null);
    log(`已删除：${id}`, 'tool');
  });
  world.events.on('object.duplicated', ({ sourceId, id }) => log(`已复制：${sourceId} → ${id}`, 'tool'));
  world.events.on('history.recorded', ({ label }) => log(`历史记录：${label}`, 'history'));
  world.events.on('history.applied', ({ direction, label }) => log(`${direction === 'undo' ? '撤销' : direction === 'redo' ? '重做' : direction}：${label}`, 'history'));
  world.events.on('sceneGraph.updated', ({ edges }) => {
    log(`场景图 · ${edges} 条关系`, 'graph');
    if (editor.selectedId && world.store.has(editor.selectedId)) inspector.render(editor.selectedId);
  });
  world.events.on('scene.autosaved', ({ objects }) => log(`已自动保存 · ${objects} 个对象`, 'autosave'));
}
