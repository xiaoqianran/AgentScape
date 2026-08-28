export function bindRuntimeEvents({ world, editor, inspector, taskPanel, ui }) {
  const log = (text, kind) => taskPanel.log(text, kind);
  world.events.on('tool.called', (event) => log(`tool: ${event.name} ${JSON.stringify(event.args)}`, 'tool'));
  world.events.on('interaction', (event) => log(`action: ${event.action} ${event.id}`, 'tool'));
  world.events.on('locomotion.started', ({ id, waypoints, pathCost }) => log(`walk: ${id} · ${waypoints} waypoints · ${pathCost ?? '?'}m`, 'tool'));
  world.events.on('locomotion.arrived', ({ id, elapsed }) => log(`arrived: ${id} · ${elapsed}s`, 'result'));
  world.events.on('locomotion.blocked', ({ id, reason }) => log(`blocked: ${id} · ${reason}`, 'error'));
  world.events.on('editor.selection', ({ id }) => {
    inspector.render(id);
    if (id) ui.setView('inspect');
  });
  world.events.on('editor.transform', ({ id }) => inspector.render(id));
  world.events.on('object.removed', ({ id }) => {
    if (editor.selectedId === id) editor.select(null);
    log(`removed: ${id}`, 'tool');
  });
  world.events.on('object.duplicated', ({ sourceId, id }) => log(`duplicate: ${sourceId} → ${id}`, 'tool'));
  world.events.on('history.recorded', ({ label }) => log(`history: ${label}`, 'history'));
  world.events.on('history.applied', ({ direction, label }) => log(`${direction}: ${label}`, 'history'));
  world.events.on('sceneGraph.updated', ({ edges }) => {
    log(`scene graph · ${edges} relations`, 'graph');
    if (editor.selectedId && world.store.has(editor.selectedId)) inspector.render(editor.selectedId);
  });
  world.events.on('scene.autosaved', ({ objects }) => log(`autosaved · ${objects} objects`, 'autosave'));
}
