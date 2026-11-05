import * as THREE from 'three';
import { createSceneFacade } from '../../../application/scene/SceneFacade.js';

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
  const labels = { open:'打开',close:'关闭',pickup:'拿起',place:'放置' };
  const scene=createSceneFacade(world);
  let busy = false;
  let selected = null;
  let frame = null;
  let viewportWidth = ui.viewport.clientWidth;
  let viewportHeight = ui.viewport.clientHeight;
  let cardWidth = 270;
  let cardHeight = 0;
  const measureViewport = () => {
    viewportWidth = ui.viewport.clientWidth;
    viewportHeight = ui.viewport.clientHeight;
  };
  const measureCard = () => {
    if (card.hidden) return;
    cardWidth = card.offsetWidth;
    cardHeight = card.offsetHeight;
  };
  const sizeObserver = typeof ResizeObserver === 'function' ? new ResizeObserver((entries) => {
    for (const entry of entries) {
      if (entry.target === ui.viewport) measureViewport();
      if (entry.target === card) measureCard();
    }
  }) : null;
  sizeObserver?.observe(ui.viewport);
  sizeObserver?.observe(card);
  if (!sizeObserver) window.addEventListener('resize', measureViewport);
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
    const hasSelection = Boolean(selected && world.queries.hasObject(selected));
    if (card.hidden !== !hasSelection) card.hidden = !hasSelection;
    actions.replaceChildren();
    status.textContent = '';
    if (!hasSelection) {
      if (frame !== null) cancelAnimationFrame(frame);
      frame = null;
      return;
    }
    const actor=scene.actors().selected;
    const affordances=scene.inspect(selected,actor?{actor}:{});
    title.textContent = selected;
    for (const entry of affordances.actions.filter(item=>item.execution==='interaction' && labels[item.action])) {
      const action=entry.action;
      const trigger=button(labels[action], async () => {
        if (busy || !actor || (entry.available!==true && !entry.canApproach)) return;
        const id=selected;
        busy=true;
        status.textContent='执行中，等待实际后置条件验证…';
        actions.querySelectorAll('button').forEach(item=>{item.disabled=true;});
        try {
          const input={actor,target:id,action,...(entry.partName?{partName:entry.partName}:{}),
            ...(action==='place' && entry.parameters?.surfaceId?.enum?.length?{surfaceId:entry.parameters.surfaceId.enum[0]}:{})};
          const job=scene.interact(input);
          const completed=await scene.waitJob(job.id);
          if(selected===id) status.textContent=completed.status==='succeeded' && completed.result?.verification.status==='verified'
            ? '动作状态已验证（不代表抓取力验证）'
            : '交互未完成：'+(completed.result?.value?.reason || completed.result?.diagnostics?.[0]?.code || completed.status);
        } catch(error) {
          if(selected===id)status.textContent=error.message;
        } finally {
          busy=false;
          actions.querySelectorAll('button').forEach(item=>{item.disabled=item.dataset.contractReady==='false';});
        }
      });
      trigger.disabled=!actor || (entry.available!==true && !entry.canApproach);
      trigger.dataset.contractReady=String(Boolean(actor && (entry.available===true || entry.canApproach)));
      trigger.title=entry.available===true ? '通过 Scene API 执行并验证' : entry.canApproach ? '自动接近后执行并验证' : entry.reason || '未检查当前可达性';
    }
    button('检查详情', () => ui.setView('inspect'));
    button('让 Agent 操作', () => {
      ui.setView('world-task');
      ui.prefillAgentCommand?.(`请操作对象 ${selected}：`);
    });
    button('取消选择', () => editor.select(null));
    measureCard();
    if (frame === null) frame = requestAnimationFrame(update);
  };
  const off = world.events.on('editor.selection', render);
  const offActor=world.events.on('scene.actor.selected',render);
  const point = new THREE.Vector3();
  const viewport = world.rendering.viewport();
  const update = () => {
    frame = null;
    if (selected && world.queries.hasObject(selected)) {
      const bounds = world.queries.getBounds(selected);
      point.fromArray(bounds.center);
      point.y = bounds.max[1] + 0.25;
      point.project(viewport.camera);
      // Hysteresis prevents flickering at the edge of the viewport.
      const limit = card.hidden ? 1.02 : 1.12;
      const visible = point.z >= -1 && point.z <= 1 && Math.abs(point.x) <= limit && Math.abs(point.y) <= limit;
      if (card.hidden !== !visible) {
        card.hidden = !visible;
        if (visible) measureCard();
      }
      if (visible) {
        const x = Math.round(Math.max(12, Math.min(viewportWidth-cardWidth-12,(point.x+1)*viewportWidth/2)));
        const y = Math.round(Math.max(60,Math.min(viewportHeight-cardHeight-80,(1-point.y)*viewportHeight/2)));
        const transform = 'translate3d(' + x + 'px, ' + y + 'px, 0)';
        if (card.style.transform !== transform) card.style.transform = transform;
      }
      frame = requestAnimationFrame(update);
    } else if (!card.hidden) card.hidden = true;
  };
  return { dispose() {
    if (frame !== null) cancelAnimationFrame(frame);
    sizeObserver?.disconnect();
    if (!sizeObserver) window.removeEventListener('resize', measureViewport);
    if (typeof off === 'function') off();
    offActor?.();
    card.remove();
  } };
}
