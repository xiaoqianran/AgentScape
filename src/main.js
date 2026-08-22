import './style.css';
import { WorldRuntime } from './runtime/WorldRuntime.js';
import { AgentTools } from './agent/AgentTools.js';
import { ToolCallingAgent } from './agent/ToolCallingAgent.js';
import { HttpLLMGateway } from './agent/gateway/HttpLLMGateway.js';
import { LocalPlannerGateway } from './agent/gateway/LocalPlannerGateway.js';
import { bootstrapWorld } from './agent/bootstrapWorld.js';
import { LocalSceneStore } from './persistence/LocalSceneStore.js';
import { AutosaveController } from './persistence/AutosaveController.js';
import { EditorController } from './editor/EditorController.js';

async function main() {
  const app = document.querySelector('#app');
  app.innerHTML = `
    <main class="shell">
      <header class="brandbar">
        <div><strong>AgentScape</strong><span>Build interactive 3D worlds for agents.</span></div>
        <div class="status"><i></i> V0.7 Asset Runtime</div>
      </header>
      <section class="workspace">
        <div id="viewport" class="viewport">
          <div class="editor-toolbar">
            <button data-mode="translate" class="active">Move <kbd>W</kbd></button>
            <button data-mode="rotate">Rotate <kbd>E</kbd></button>
            <span></span>
            <button id="duplicate">Duplicate</button>
            <button id="delete" class="danger">Delete</button>
            <span></span>
            <button id="undo" disabled>Undo <kbd>⌘Z</kbd></button>
            <button id="redo" disabled>Redo</button>
            <span></span>
            <button id="save-scene">Save</button>
            <button id="load-scene">Load</button>
            <button id="export-scene">Export</button>
            <button id="import-scene">Import</button>
            <input id="import-scene-file" type="file" accept="application/json,.json" hidden />
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
            <div class="console-heading"><div class="eyebrow">AGENT CONSOLE</div><span id="agent-mode" class="agent-mode">LOCAL</span></div>
            <p class="intro">Tool-calling Agent 与 Human Editor 共用同一个 World Runtime。配置你的 LLM Gateway 后即可执行自然语言多步规划。</p>
            <details class="gateway-settings">
              <summary>LLM Gateway</summary>
              <label>Endpoint<input id="gateway-endpoint" type="url" placeholder="https://your-server.example/agent" /></label>
              <small>只保存 Gateway URL，不在浏览器保存模型 API Key。留空时使用本地 planner。</small>
            </details>
            <details class="gateway-settings asset-settings">
              <summary>Asset Library / Generator</summary>
              <div class="asset-search"><input id="asset-query" placeholder="搜索 chair / 椅子 / cup" /><button id="asset-search-button">Search</button></div>
              <div id="asset-results" class="asset-results"></div>
              <label>Generator Endpoint<input id="asset-generator-endpoint" type="url" placeholder="https://your-server.example/generate-3d" /></label>
              <small>搜索不到时 Agent 才应调用生成器。生成器返回 GLB URL + manifest。</small>
            </details>
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
  const gateway = new HttpLLMGateway({ endpoint: localStorage.getItem('agentscape.gatewayEndpoint') || '' });
  const agent = new ToolCallingAgent({ tools, gateway, fallbackGateway: new LocalPlannerGateway(), log });
  const editor = new EditorController(world);
  const sceneStore = new LocalSceneStore();
  const autosave = new AutosaveController({ runtime: world, store: sceneStore, delayMs: 600 }).start();

  world.events.on('tool.called', (event) => log(`tool: ${event.name} ${JSON.stringify(event.args)}`, 'tool'));
  world.events.on('interaction', (event) => log(`action: ${event.action} ${event.id}`, 'tool'));
  world.events.on('editor.selection', ({ id }) => renderInspector(id));
  world.events.on('editor.transform', ({ id }) => renderInspector(id));
  world.events.on('object.removed', ({ id }) => log(`removed: ${id}`, 'tool'));
  world.events.on('object.duplicated', ({ sourceId, id }) => log(`duplicate: ${sourceId} → ${id}`, 'tool'));
  const undoButton = document.querySelector('#undo');
  const redoButton = document.querySelector('#redo');
  const updateHistoryButtons = (status = world.history.status()) => { undoButton.disabled = !status.canUndo; redoButton.disabled = !status.canRedo; };
  world.events.on('history.changed', updateHistoryButtons);
  world.events.on('history.recorded', ({ label }) => log(`history: ${label}`, 'history'));
  world.events.on('history.applied', ({ direction, label }) => log(`${direction}: ${label}`, 'history'));
  world.events.on('scene.autosaved', ({ objects }) => log(`autosaved · ${objects} objects`, 'autosave'));
  updateHistoryButtons();

  if (sceneStore.has()) {
    try {
      await world.restore(sceneStore.load());
      log('autosave restored', 'result');
    } catch (error) {
      log(`autosave restore failed: ${error.message}`, 'error');
      await bootstrapWorld(tools);
    }
  } else {
    await bootstrapWorld(tools);
  }
  world.history.clear();
  log(`scene ready · ${world.listObjects().length} objects`, 'result');

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

  const assetGeneratorInput = document.querySelector('#asset-generator-endpoint');
  assetGeneratorInput.value = world.assetGenerator.endpoint || '';
  assetGeneratorInput.addEventListener('change', () => {
    world.assetGenerator.setEndpoint(assetGeneratorInput.value);
    if (world.assetGenerator.endpoint) localStorage.setItem('agentscape.assetGeneratorEndpoint', world.assetGenerator.endpoint);
    else localStorage.removeItem('agentscape.assetGeneratorEndpoint');
    log(world.assetGenerator.isConfigured() ? `asset generator: ${world.assetGenerator.endpoint}` : 'asset generator disabled', 'result');
  });

  const assetQuery = document.querySelector('#asset-query');
  const assetResults = document.querySelector('#asset-results');
  const renderAssetResults = (assets) => {
    assetResults.innerHTML = '';
    for (const asset of assets) {
      const row = document.createElement('div'); row.className = 'asset-result';
      const meta = document.createElement('div'); meta.innerHTML = `<strong>${asset.label}</strong><small>${asset.id} · ${asset.source}</small>`;
      const spawn = document.createElement('button'); spawn.textContent = 'Spawn';
      spawn.addEventListener('click', async () => {
        try { const id = await tools.call('spawnAsset', { assetId: asset.id, position: [1.5, 0, 1.2] }); log(`spawned ${id}`, 'result'); }
        catch (error) { log(`error: ${error.message}`, 'error'); }
      });
      row.append(meta, spawn); assetResults.appendChild(row);
    }
    if (!assets.length) assetResults.textContent = 'No reusable asset found.';
  };
  const searchAssets = () => renderAssetResults(world.assetLibrary.search(assetQuery.value, { limit: 6 }));
  document.querySelector('#asset-search-button').addEventListener('click', searchAssets);
  assetQuery.addEventListener('keydown', (event) => { if (event.key === 'Enter') { event.preventDefault(); searchAssets(); } });
  renderAssetResults(world.assetLibrary.list().slice(0, 4));

  const gatewayInput = document.querySelector('#gateway-endpoint');
  const modeBadge = document.querySelector('#agent-mode');
  gatewayInput.value = gateway.endpoint || '';
  const updateAgentMode = () => {
    modeBadge.textContent = gateway.isConfigured() ? 'LLM' : 'LOCAL';
    modeBadge.classList.toggle('live', gateway.isConfigured());
  };
  updateAgentMode();
  gatewayInput.addEventListener('change', () => {
    gateway.setEndpoint(gatewayInput.value);
    if (gateway.endpoint) localStorage.setItem('agentscape.gatewayEndpoint', gateway.endpoint);
    else localStorage.removeItem('agentscape.gatewayEndpoint');
    updateAgentMode();
    log(gateway.isConfigured() ? `LLM gateway: ${gateway.endpoint}` : 'LLM gateway disabled; using local planner', 'result');
  });

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
  const downloadJson = (filename, value) => {
    const blob = new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = filename; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  };

  document.querySelector('#save-scene').addEventListener('click', () => {
    const scene = world.serialize({ name: 'AgentScape World' });
    sceneStore.save(scene);
    log(`scene saved locally · ${scene.objects.length} objects`, 'result');
  });
  document.querySelector('#load-scene').addEventListener('click', async () => {
    try {
      const scene = sceneStore.load();
      if (!scene) return log('no local scene saved yet', 'error');
      editor.select(null);
      await world.restore(scene);
      log(`scene restored · ${scene.objects.length} objects`, 'result');
    } catch (error) { log(`restore error: ${error.message}`, 'error'); }
  });
  document.querySelector('#export-scene').addEventListener('click', () => {
    const scene = world.serialize({ name: 'AgentScape World' });
    downloadJson('agentscape-scene.json', scene);
    log(`scene exported · schema v${scene.schemaVersion}`, 'result');
  });
  const importFile = document.querySelector('#import-scene-file');
  document.querySelector('#import-scene').addEventListener('click', () => importFile.click());
  importFile.addEventListener('change', async () => {
    const file = importFile.files?.[0]; if (!file) return;
    try {
      const scene = JSON.parse(await file.text());
      editor.select(null);
      await world.restore(scene);
      sceneStore.save(scene);
      log(`scene imported · ${scene.objects.length} objects`, 'result');
    } catch (error) { log(`import error: ${error.message}`, 'error'); }
    finally { importFile.value = ''; }
  });

  undoButton.addEventListener('click', async () => { editor.select(null); await world.history.undo(); });
  redoButton.addEventListener('click', async () => { editor.select(null); await world.history.redo(); });

  document.querySelector('#duplicate').addEventListener('click', () => editor.duplicateSelected().catch(error => log(`error: ${error.message}`, 'error')));
  document.querySelector('#delete').addEventListener('click', () => editor.deleteSelected()?.catch?.(error => log(`error: ${error.message}`, 'error')));

  window.addEventListener('keydown', (event) => {
    if (event.target.matches('input, textarea')) return;
    const command = event.ctrlKey || event.metaKey;
    if (command && event.key.toLowerCase() === 'z') {
      event.preventDefault(); editor.select(null);
      if (event.shiftKey) world.history.redo(); else world.history.undo();
      return;
    }
    if (command && event.key.toLowerCase() === 'y') { event.preventDefault(); editor.select(null); world.history.redo(); return; }
    if (event.key.toLowerCase() === 'w') editor.setMode('translate');
    if (event.key.toLowerCase() === 'e') editor.setMode('rotate');
    if (event.key === 'Delete' || event.key === 'Backspace') editor.deleteSelected();
  });
}

main().catch((err) => {
  console.error(err);
  document.body.innerHTML = `<pre style="color:white;padding:24px">AgentScape failed to start: ${err.message}</pre>`;
});
