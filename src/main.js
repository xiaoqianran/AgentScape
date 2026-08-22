import './style.css';
import { WorldRuntime } from './runtime/WorldRuntime.js';
import { AgentTools } from './agent/AgentTools.js';
import { DemoAgent } from './agent/DemoAgent.js';
import { EditorController } from './editor/EditorController.js';

async function main() {
  const app = document.querySelector('#app');
  app.innerHTML = `
    <main class="shell">
      <header class="brandbar">
        <div><strong>AgentScape</strong><span>Build interactive 3D worlds for agents.</span></div>
        <div class="status"><i></i> V0.4 Editor Runtime</div>
      </header>
      <section class="workspace">
        <div id="viewport" class="viewport">
          <div class="editor-toolbar">
            <button data-mode="translate" class="active">Move <kbd>W</kbd></button>
            <button data-mode="rotate">Rotate <kbd>E</kbd></button>
            <span></span>
            <button id="duplicate">Duplicate</button>
            <button id="delete" class="danger">Delete</button>
          </div>
          <div class="hint">点击选择 · 拖拽 Gizmo 编辑 · W 移动 · E 旋转 · Delete 删除</div>
        </div>
        <aside class="panel">
          <section class="inspector">
            <div class="eyebrow">INSPECTOR</div>
            <div id="empty-selection" class="empty-selection">点击场景中的对象进行编辑</div>
            <div id="selection" class="selection hidden">
              <div class="object-title"><h1 id="object-id"></h1><span id="object-type"></span></div>
              <dl class="properties">
                <div><dt>Asset</dt><dd id="asset-id"></dd></div>
                <div><dt>Position</dt><dd id="position"></dd></div>
                <div><dt>Rotation</dt><dd id="rotation"></dd></div>
              </dl>
              <div id="spatial-info" class="spatial-info"></div>
              <div id="actions" class="action-list"></div>
            </div>
          </section>
          <section class="agent-console">
            <div class="eyebrow">AGENT CONSOLE</div>
            <p class="intro">Human Editor 与 Agent 共用同一个 World Runtime。你拖动物体和 Agent 调用工具最终修改的是同一份世界状态。</p>
            <div class="chips">
              <button data-prompt="打开柜子">打开柜子</button>
              <button data-prompt="关闭柜子">关闭柜子</button>
              <button data-prompt="拿起杯子">拿起杯子</button>
              <button data-prompt="把杯子放到桌上">放到桌上</button>
              <button data-prompt="建立一个咖啡角">建立咖啡角</button>
            </div>
            <div id="log" class="log"></div>
            <form id="command" class="command">
              <input id="input" autocomplete="off" placeholder="例如：打开柜子" />
              <button type="submit">执行</button>
            </form>
          </section>
        </aside>
      </section>
    </main>`;

  const logEl = document.querySelector('#log');
  const log = (text, kind = '') => {
    const row = document.createElement('div');
    row.className = `log-row ${kind}`;
    row.textContent = text;
    logEl.prepend(row);
  };

  const world = new WorldRuntime(document.querySelector('#viewport'));
  await world.init();
  const tools = new AgentTools(world);
  const agent = new DemoAgent(tools, log);
  const editor = new EditorController(world);

  world.events.on('tool.called', (event) => log(`tool: ${event.name} ${JSON.stringify(event.args)}`, 'tool'));
  world.events.on('interaction', (event) => log(`action: ${event.action} ${event.id}`, 'tool'));
  world.events.on('editor.selection', ({ id }) => renderInspector(id));
  world.events.on('editor.transform', ({ id }) => renderInspector(id));
  world.events.on('object.removed', ({ id }) => log(`removed: ${id}`, 'tool'));
  world.events.on('object.duplicated', ({ sourceId, id }) => log(`duplicate: ${sourceId} → ${id}`, 'tool'));

  await agent.bootstrap();
  log('scene ready: table_01 · cabinet_01 · cup_01', 'result');

  function renderInspector(id) {
    const empty = document.querySelector('#empty-selection');
    const selection = document.querySelector('#selection');
    if (!id) { empty.classList.remove('hidden'); selection.classList.add('hidden'); return; }
    const info = world.getObjectInfo(id);
    empty.classList.add('hidden'); selection.classList.remove('hidden');
    document.querySelector('#object-id').textContent = info.id;
    document.querySelector('#object-type').textContent = info.type;
    document.querySelector('#asset-id').textContent = info.asset;
    document.querySelector('#position').textContent = info.position.join(', ');
    document.querySelector('#rotation').textContent = `${info.rotation.join(', ')}°`;
    const bounds = world.spatial.getBounds(id);
    const nearby = world.spatial.findNearby(id, 2);
    const spatial = document.querySelector('#spatial-info');
    spatial.textContent = `size ${bounds.size.join(' × ')} · nearby ${nearby.length}`;
    const actions = document.querySelector('#actions');
    actions.innerHTML = '';
    for (const action of info.actions) {
      if (!['open', 'close', 'pickup', 'drop'].includes(action)) continue;
      const button = document.createElement('button');
      button.textContent = action;
      button.addEventListener('click', async () => {
        try { await tools.call(action === 'drop' ? 'drop' : action, action === 'drop' ? { id } : { id }); }
        catch (error) { log(`error: ${error.message}`, 'error'); }
      });
      actions.appendChild(button);
    }
  }

  async function execute(prompt) {
    try { await agent.run(prompt); }
    catch (err) { log(`error: ${err.message}`, 'error'); }
  }

  document.querySelectorAll('[data-prompt]').forEach(btn => btn.addEventListener('click', () => execute(btn.dataset.prompt)));
  document.querySelector('#command').addEventListener('submit', async (event) => {
    event.preventDefault();
    const input = document.querySelector('#input');
    if (!input.value.trim()) return;
    const value = input.value; input.value = ''; await execute(value);
  });

  document.querySelectorAll('[data-mode]').forEach(button => button.addEventListener('click', () => {
    editor.setMode(button.dataset.mode);
    document.querySelectorAll('[data-mode]').forEach(b => b.classList.toggle('active', b === button));
  }));
  document.querySelector('#duplicate').addEventListener('click', () => editor.duplicateSelected().catch(error => log(`error: ${error.message}`, 'error')));
  document.querySelector('#delete').addEventListener('click', () => editor.deleteSelected());

  window.addEventListener('keydown', (event) => {
    if (event.target.matches('input, textarea')) return;
    if (event.key.toLowerCase() === 'w') editor.setMode('translate');
    if (event.key.toLowerCase() === 'e') editor.setMode('rotate');
    if (event.key === 'Delete' || event.key === 'Backspace') editor.deleteSelected();
  });
}

main().catch((err) => {
  console.error(err);
  document.body.innerHTML = `<pre style="color:white;padding:24px">AgentScape failed to start: ${err.message}</pre>`;
});
