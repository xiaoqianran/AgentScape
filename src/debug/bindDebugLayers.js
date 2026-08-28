import { DebugOverlay } from './DebugOverlay.js';

/**
 * 将 DebugOverlay 绑定到页面工具栏。
 *
 * 约束：
 * - 只读消费 Runtime，不改写 Runtime 方法、不写入世界状态。
 * - 物理能力缺失时对应图层禁用并说明原因，不伪造真值。
 * - 未启用任何图层时不启动独立刷新循环，保持零持续开销。
 */

const LAYER_LABELS = Object.freeze({
  collider: { label: '碰撞体', hint: 'Manifest 碰撞体线框（根节点 + Part）' },
  joint: { label: '关节转轴', hint: 'revolute / prismatic 轴与枢轴点' },
  bounds: { label: '包围盒', hint: '世界空间 AABB' },
  relations: { label: '空间关系', hint: 'ON / NEAR 等语义关系连线' },
  interaction: { label: '交互与持有', hint: '持有锚点、携带连线与 1.5 米交互圈' },
  navmesh: { label: '导航网格', hint: 'Recast NavMesh 顶点云' }
});

const UNAVAILABLE_REASON = Object.freeze({
  collider: '物理后端缺少 collision 能力',
  joint: '物理后端缺少 articulated-body 能力',
  bounds: '无对象',
  relations: '场景图未就绪',
  interaction: '交互系统未就绪',
  navmesh: '导航系统未就绪'
});

export function bindDebugLayers(world, { log = () => {} } = {}) {
  const menu = document.querySelector('#debug-layer-menu');
  if (!menu) return null;

  const overlay = new DebugOverlay(world);
  overlay.attach();
  menu.replaceChildren();

  for (const [key, meta] of Object.entries(LAYER_LABELS)) {
    const row = document.createElement('label');
    row.className = 'debug-layer-row';
    row.title = meta.hint;
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.dataset.layer = key;
    const text = document.createElement('span');
    text.textContent = meta.label;
    row.append(input, text);
    menu.append(row);
  }

  const schedule = globalThis.requestAnimationFrame?.bind(globalThis);
  const cancel = globalThis.cancelAnimationFrame?.bind(globalThis);
  let frameId = null;
  const hasEnabledLayers = () => overlay.enabled.size > 0;
  const tick = () => {
    frameId = null;
    if (!hasEnabledLayers()) return;
    overlay.update();
    if (schedule) frameId = schedule(tick);
  };
  const syncLoop = () => {
    if (!hasEnabledLayers()) {
      if (frameId != null && cancel) cancel(frameId);
      frameId = null;
      return;
    }
    if (frameId == null && schedule) frameId = schedule(tick);
  };

  const syncAvailability = () => {
    const available = overlay.availableLayers;
    for (const input of menu.querySelectorAll('input[data-layer]')) {
      const key = input.dataset.layer;
      const usable = available[key] !== false;
      input.disabled = !usable;
      input.parentElement.title = usable
        ? LAYER_LABELS[key].hint
        : `${LAYER_LABELS[key].hint} — 不可用：${UNAVAILABLE_REASON[key] || '能力缺失'}`;
      if (!usable && input.checked) {
        input.checked = false;
        overlay.toggle(key, false);
      }
    }
    syncLoop();
  };

  for (const input of menu.querySelectorAll('input[data-layer]')) {
    input.addEventListener('change', () => {
      const key = input.dataset.layer;
      const next = overlay.toggle(key, input.checked);
      input.checked = next;
      log(`调试图层 ${key} ${next ? '已开启' : '已关闭'}`, 'result');
      syncLoop();
    });
  }

  syncAvailability();

  const dispose = () => {
    if (frameId != null && cancel) cancel(frameId);
    frameId = null;
    overlay.dispose();
    menu.replaceChildren();
  };
  return { overlay, dispose, syncAvailability };
}
