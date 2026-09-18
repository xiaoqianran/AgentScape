import * as THREE from 'three';

// Selection is UI state; all actions still pass through the production tool boundary.
export function mountWorldContext({ world, editor, tools, ui }) {
  const card = document.createElement('section');
  card.className = 'world-context';
  card.setAttribute('aria-label', '对象操作');
  card.hidden = true;
  const title = document.createElement('strong');
  const actions = document.createElement('div');
  const status = document.createElement('p');
  status.setAttribute('role', 'status');
  card.append(title, actions, status);
  ui.viewport.append(card);
  const labels = { open:'打开',close:'关闭',pickup:'拿起',drop:'放下' };
  let busy = false;
  let selected = null;
  const button = (label, run) => {
    const element = document.createElement('button');
    element.type = 'button';
    element.textContent = label;
    element.addEventListener('click', run);
    actions.append(element);
    return element;
  };
  const render = () => {
    selected = editor.selectedId;
    card.hidden = !selected || !world.queries.hasObject(selected);
    actions.replaceChildren();
    status.textContent = '';
    if (card.hidden) return;
    const info = world.queries.getObjectInfo(selected);
    title.textContent = selected;
    for (const action of info.actions.filter(value => labels[value])) {
      button(labels[action], async () => {
        if (busy) return;
        const id = selected;
        busy = true;
        status.textContent = '正在执行…';
        actions.querySelectorAll('button').forEach(item => { item.disabled = true; });
        try {
          await tools.call(action, { id });
          if (selected === id) status.textContent = '已执行';
        } catch (error) {
          if (selected === id) status.textContent = error.message;
        } finally {
          busy = false;
          actions.querySelectorAll('button').forEach(item => { item.disabled = false; });
        }
      });
    }
    button('检查详情', () => ui.setView('inspect'));
    button('让 Agent 操作', () => {
      ui.setView('task');
      ui.commandInput.value = `请操作对象 ${selected}：`;
      ui.commandInput.focus();
    });
    button('取消选择', () => editor.select(null));
  };
  const off = world.events.on('editor.selection', render);
  const point = new THREE.Vector3();
  const viewport = world.rendering.viewport();
  let frame;
  const update = () => {
    if (selected && world.queries.hasObject(selected)) {
      const bounds = world.queries.getBounds(selected);
      point.fromArray(bounds.center);
      point.y = bounds.max[1] + 0.25;
      point.project(viewport.camera);
      card.hidden = point.z < -1 || point.z > 1 || Math.abs(point.x) > 1.1 || Math.abs(point.y) > 1.1;
      const width = ui.viewport.clientWidth;
      const height = ui.viewport.clientHeight;
      card.style.left = `${Math.max(12, Math.min(width-card.offsetWidth-12,(point.x+1)*width/2))}px`;
      card.style.top = `${Math.max(60,Math.min(height-card.offsetHeight-80,(1-point.y)*height/2))}px`;
    } else card.hidden = true;
    frame = requestAnimationFrame(update);
  };
  update();
  return { dispose() { cancelAnimationFrame(frame); if (typeof off === 'function') off(); card.remove(); } };
}
