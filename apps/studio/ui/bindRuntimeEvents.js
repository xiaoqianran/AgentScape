export function bindRuntimeEvents({ world, editor, inspector, taskPanel, ui, autosave = null, reload = () => location.reload() }) {
  const disposers = [];
  const listen = (type, handler) => {
    const dispose = world.events.on(type,handler);
    if (typeof dispose === 'function') disposers.push(dispose);
  };
  const log = (text,kind)=>taskPanel.log(text,kind);

  listen('renderer.device-lost',({ api, reason, message })=>{
    let saved=false;
    try {
      saved=Boolean(autosave?.flush?.());
    } catch (error) {
      log(`渲染中断后的自动保存失败：${error.message}`,'error');
    }
    const backend=api || 'GPU';
    ui.setRuntimeStatus('error','渲染已中断 · 点击恢复');
    ui.setRuntimeRecoveryAction?.(reload,'渲染已中断 · 点击恢复');
    log(`渲染设备丢失：${backend} · ${reason || 'unknown'} · ${message || 'unknown'}${saved ? ' · 场景已保存' : ''}`,'error');
  });
  listen('renderer.error',({ type, message })=>log(`渲染错误：${type || 'GPUError'} · ${message || 'unknown'}`,'error'));
  listen('renderer.generated-visual-ready',({ format, splatCount })=>{
    const count=Number.isFinite(splatCount) ? splatCount.toLocaleString() : '?';
    log(`生成视觉已就绪：${String(format || 'unknown').toUpperCase()} · ${count} splats`,'result');
  });
  listen('renderer.generated-visual-error',({ format, message })=>{
    log(`生成视觉加载失败：${String(format || 'unknown').toUpperCase()} · ${message || 'unknown'}`,'error');
  });
  listen('tool.called',(event)=>{
    taskPanel.observeAgentTool?.(event);
    log(`工具：${event.name} ${JSON.stringify(event.args)}`,'tool');
  });
  listen('agent.sequence',(event)=>taskPanel.observeAgentSequence?.(event));
  listen('interaction',(event)=>log(`动作：${event.action} ${event.id}`,'tool'));
  listen('locomotion.started',({ id, waypoints, pathCost })=>log(`行走：${id} · ${waypoints} 个路径点 · ${pathCost ?? '?'} 米`,'tool'));
  listen('locomotion.arrived',({ id, elapsed })=>log(`已到达：${id} · ${elapsed} 秒`,'result'));
  listen('locomotion.blocked',({ id, reason })=>log(`受阻：${id} · ${reason}`,'error'));
  listen('editor.selection',({ id })=>{
    inspector.render(id);
    if (id) ui.setView('inspect');
  });
  listen('editor.transform',({ id })=>inspector.render(id));
  listen('object.removed',({ id })=>{
    if (editor.selectedId === id) editor.select(null);
    log(`已删除：${id}`,'tool');
  });
  listen('object.duplicated',({ sourceId, id })=>log(`已复制：${sourceId} → ${id}`,'tool'));
  listen('history.recorded',({ label })=>log(`历史记录：${label}`,'history'));
  listen('history.applied',({ direction, label })=>log(`${direction === 'undo' ? '撤销' : direction === 'redo' ? '重做' : direction}：${label}`,'history'));
  listen('sceneGraph.updated',({ edges })=>{
    log(`场景图 · ${edges} 条关系`,'graph');
    if (editor.selectedId && world.queries.hasObject(editor.selectedId)) inspector.render(editor.selectedId);
  });
  listen('scene.autosaved',({ objects })=>log(`已自动保存 · ${objects} 个对象`,'autosave'));

  return {
    dispose() {
      while (disposers.length) disposers.pop()?.();
    }
  };
}
