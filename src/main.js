import './style.css';
import { WorldRuntime } from './runtime/WorldRuntime.js';
import { AgentTools } from './agent/AgentTools.js';
import { ToolCallingAgent } from './agent/ToolCallingAgent.js';
import { HttpLLMGateway } from './agent/gateway/HttpLLMGateway.js';
import { LocalPlannerGateway } from './agent/gateway/LocalPlannerGateway.js';
import { bootstrapWorld } from './agent/bootstrapWorld.js';
import { LocalSceneStore } from './persistence/LocalSceneStore.js';
import { AutosaveController } from './persistence/AutosaveController.js';
import { RESOURCE_BUDGET } from './compiler/resourceBudget.js';
import { EditorController } from './editor/EditorController.js';
import { ENVIRONMENTS, resolveEnvironment } from './content/environments.js';

async function main() {
  const app = document.querySelector('#app');
  const environmentDefinition = resolveEnvironment(new URLSearchParams(location.search).get('world'));
  const environmentFactory = await environmentDefinition.load();
  const environmentOptions = ENVIRONMENTS.map((item) => `<option value="${item.id}"${item.id === environmentDefinition.id ? ' selected' : ''}>${item.number} · ${item.title}</option>`).join('');
  app.innerHTML = `
    <main class="shell" data-world="${environmentDefinition.id}">
      <header class="brandbar">
        <div class="brand-lockup"><strong>AgentScape</strong><span>${environmentDefinition.number} · ${environmentDefinition.title.toUpperCase()}</span></div>
        <div class="brand-actions"><select id="world-select" class="world-select" aria-label="World">${environmentOptions}</select><button id="cinematic-toggle" class="cinematic-toggle">Cinematic</button><div class="status"><i></i> LIVE WORLD</div></div>
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
          <div class="world-intro">
            <div class="world-kicker">${environmentDefinition.number} // ${environmentDefinition.title.toUpperCase()}</div>
            <h2>${environmentDefinition.headline}</h2>
            <p>${environmentDefinition.description}</p>
            <div class="world-facts">${environmentDefinition.facts.map((fact) => `<span>${fact}</span>`).join('')}</div>
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
              <div id="relation-info" class="relation-info"></div>
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
            <details class="gateway-settings engine-settings" open>
              <summary>Engine / Validation</summary>
              <div class="engine-actions">
                <button id="validate-world">Validate</button>
                <button id="repair-world">Repair</button>
                <button id="verify-trace">Verify Trace</button>
              </div>
              <div id="engine-report" class="engine-report">Engine ready.</div>
            </details>
            <details class="gateway-settings compiler-settings" open>
              <summary>Agent-Ready Asset Compiler</summary>
              <div class="asset-search"><input id="compiler-url" type="url" placeholder="https://.../model.glb" /><button id="compile-url-button">Compile URL</button></div>
              <div class="compiler-file-row"><input id="compiler-file" type="file" accept=".glb,model/gltf-binary" /><button id="compile-file-button">Compile File</button></div>
              <label>Compiler Endpoint<input id="compiler-endpoint" type="url" placeholder="https://your-server.example/compile" /></label>
              <small>本地 pass: glTF inspect/optimize、bounds、语义/关节候选、fallback collider。配置后端后可升级为 CoACD/视觉语义/关节推断。</small>
              <div id="compiler-report" class="engine-report">No asset compiled yet.</div>
            </details>
            <details class="gateway-settings asset-settings">
              <summary>Asset Library / Generator</summary>
              <div class="asset-search"><input id="asset-query" placeholder="搜索 chair / 椅子 / cup" /><button id="asset-search-button">Search</button></div>
              <div id="asset-results" class="asset-results"></div>
              <label>Generator Endpoint<input id="asset-generator-endpoint" type="url" placeholder="https://your-server.example/generate-3d" /></label>
              <small>搜索不到时 Agent 才应调用生成器。生成器返回 GLB URL + manifest。</small>
            </details>
            <div class="chips">
              <button data-prompt="让 agent_01 走到 cabinet_01 前并打开柜门">走过去打开柜门</button>
              <button data-prompt="让 agent_01 走到 cabinet_01 前并关闭柜门">走过去关闭柜门</button>
              <button data-prompt="让 agent_01 走到 cup_01 前并拿起杯子">走过去拿起杯子</button>
              <button data-prompt="让 agent_01 把当前拿着的物体放到 table_01 上">把手中物体放到桌上</button>
              <button data-prompt="让 agent_01 放下当前拿着的物体">放下手中物体</button>
              <button data-prompt="建立一个咖啡角">建立咖啡角</button>
            </div>
            <div id="log" class="log"></div>
            <form id="command" class="command">
              <input id="input" autocomplete="off" placeholder="例如：让 agent_01 走到 cabinet_01 前并打开柜门" />
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

  const world = new WorldRuntime(document.querySelector('#viewport'), { environmentFactory });
  await world.init();
  const tools = new AgentTools(world);
  const gateway = new HttpLLMGateway({ endpoint: localStorage.getItem('agentscape.gatewayEndpoint') || '' });
  const agent = new ToolCallingAgent({ tools, gateway, fallbackGateway: new LocalPlannerGateway({ coffeeCorner:environmentDefinition.coffeeCorner }), log });
  const editor = new EditorController(world);
  const shell = document.querySelector('.shell');
  document.querySelector('#world-select').addEventListener('change', (event) => {
    const url = new URL(location.href);
    url.searchParams.set('world', event.target.value);
    location.href = url.toString();
  });
  const cinematicButton = document.querySelector('#cinematic-toggle');
  cinematicButton.addEventListener('click', () => {
    const enabled = shell.classList.toggle('cinematic');
    cinematicButton.textContent = enabled ? 'Editor' : 'Cinematic';
    requestAnimationFrame(() => world.resize());
  });
  const sceneStore = new LocalSceneStore({ key:`agentscape.scene.autosave.${environmentDefinition.id}` });
  if (environmentDefinition.id === 'monument-hall' && !sceneStore.has()) {
    const legacy = new LocalSceneStore();
    if (legacy.has()) sceneStore.save(legacy.load());
  }
  const autosave = new AutosaveController({ runtime: world, store: sceneStore, delayMs: 600 }).start();

  world.events.on('tool.called', (event) => log(`tool: ${event.name} ${JSON.stringify(event.args)}`, 'tool'));
  world.events.on('interaction', (event) => log(`action: ${event.action} ${event.id}`, 'tool'));
  world.events.on('locomotion.started', ({ id, waypoints, pathCost }) => log(`walk: ${id} · ${waypoints} waypoints · ${pathCost ?? '?'}m`, 'tool'));
  world.events.on('locomotion.arrived', ({ id, elapsed }) => log(`arrived: ${id} · ${elapsed}s`, 'result'));
  world.events.on('locomotion.blocked', ({ id, reason }) => log(`blocked: ${id} · ${reason}`, 'error'));
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
  world.events.on('sceneGraph.updated', ({ edges }) => log(`scene graph · ${edges} relations`, 'graph'));
  world.events.on('scene.autosaved', ({ objects }) => log(`autosaved · ${objects} objects`, 'autosave'));
  updateHistoryButtons();

  if (sceneStore.has()) {
    try {
      await world.restore(sceneStore.load());
      log('autosave restored', 'result');
      const hasAgent = world.store.list().some(([, record]) => record.manifest.type === 'agent');
      if (!hasAgent && environmentDefinition.bootstrap.agent) {
        await tools.call('spawnAsset', { assetId:'agent', position:environmentDefinition.bootstrap.agent, instanceId:'agent_01' });
        log('legacy autosave upgraded · agent_01 added', 'result');
      }
    } catch (error) {
      log(`autosave restore failed: ${error.message}`, 'error');
      await bootstrapWorld(tools, environmentDefinition.bootstrap);
    }
  } else {
    await bootstrapWorld(tools, environmentDefinition.bootstrap);
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
    world.sceneGraph.update();
    const relations = world.sceneGraph.describe(id);
    const relationInfo = document.querySelector('#relation-info');
    relationInfo.innerHTML = '';
    const visible = relations.outgoing.filter(r => ['ON','NEAR','INSIDE'].includes(r.predicate)).slice(0, 6);
    for (const rel of visible) { const row = document.createElement('div'); row.textContent = `${rel.predicate} → ${rel.object}`; relationInfo.appendChild(row); }
    if (!visible.length) relationInfo.textContent = 'No semantic relations';
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

  const engineReport = document.querySelector('#engine-report');
  let lastValidation = null;
  const renderValidation = (report) => {
    engineReport.innerHTML = `<strong>${report.ok ? 'PASS' : 'FAIL'}</strong> · hard ${report.counts.hard} · advisory ${report.counts.advisory} · ${report.coverage.objects} objects · ${report.coverage.relations} relations`;
  };
  document.querySelector('#validate-world').addEventListener('click', async () => {
    try { lastValidation = await tools.call('validateWorld', {}); renderValidation(lastValidation); log(`validate · hard ${lastValidation.counts.hard} advisory ${lastValidation.counts.advisory}`, lastValidation.ok ? 'result' : 'error'); }
    catch (error) { log(`validate error: ${error.message}`, 'error'); }
  });
  document.querySelector('#repair-world').addEventListener('click', async () => {
    try {
      const result = await tools.call('repairWorld', { report: lastValidation || undefined });
      lastValidation = await tools.call('validateWorld', {}); renderValidation(lastValidation);
      log(`repair · ${result.accepted ? 'accepted' : 'rejected'} · ${result.applied?.length || 0} changes`, result.accepted ? 'result' : 'error');
    } catch (error) { log(`repair error: ${error.message}`, 'error'); }
  });
  document.querySelector('#verify-trace').addEventListener('click', async () => {
    try { const result = await tools.call('verifyTrace', {}); engineReport.textContent = `Trace ${result.ok ? 'PASS' : 'FAIL'} · ${result.entries ?? 0} events · ${result.lastHash || 'no hash'}`; }
    catch (error) { log(`trace error: ${error.message}`, 'error'); }
  });

  const compilerEndpointInput = document.querySelector('#compiler-endpoint');
  const compilerReport = document.querySelector('#compiler-report');
  compilerEndpointInput.value = world.compilerProvider.endpoint || '';
  compilerEndpointInput.addEventListener('change', () => {
    world.compilerProvider.setEndpoint(compilerEndpointInput.value);
    if (world.compilerProvider.endpoint) localStorage.setItem('agentscape.compilerEndpoint', world.compilerProvider.endpoint);
    else localStorage.removeItem('agentscape.compilerEndpoint');
    log(world.compilerProvider.isConfigured() ? `compiler provider: ${world.compilerProvider.endpoint}` : 'compiler provider disabled; using local passes', 'result');
  });
  const renderCompileResult = (result) => {
    const m = result.manifest, i = result.inspection.stats;
    compilerReport.innerHTML = `<strong>${m.id}</strong> · ${result.quality.status} · ${m.type} · ${i.nodes} nodes · ${i.meshes} meshes · collider ${m.compiler.collisionStrategy} · semantic ${(m.compiler.semanticConfidence * 100).toFixed(0)}%`;
  };
  const compileAndRegister = async (input) => {
    try {
      compilerReport.textContent = 'Compiling…';
      const response = await world.skills.invoke('compileAsset', input, { profile:'builder', actor:'human' });
      if (!response.success) throw new Error(response.error.message);
      renderCompileResult(response.result);
      log(`compiled asset: ${response.result.manifest.id}`, 'result');
      renderAssetResults(world.assetLibrary.list().slice(0, 8));
    } catch (error) {
      compilerReport.textContent = `Compile failed: ${error.message}`;
      log(`compile error: ${error.message}`, 'error');
    }
  };
  document.querySelector('#compile-url-button').addEventListener('click', () => {
    const url = document.querySelector('#compiler-url').value.trim();
    if (url) compileAndRegister({ url });
  });
  document.querySelector('#compile-file-button').addEventListener('click', async () => {
    const file = document.querySelector('#compiler-file').files?.[0];
    if (!file) return;
    if (file.size > RESOURCE_BUDGET.maxInputBytes) {
      compilerReport.textContent = `文件过大：${Math.ceil(file.size / 1024 / 1024)} MiB，当前上限 ${Math.ceil(RESOURCE_BUDGET.maxInputBytes / 1024 / 1024)} MiB。`;
      return;
    }
    compileAndRegister({ bytes: new Uint8Array(await file.arrayBuffer()), sourceName: file.name });
  });

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
    downloadJson(`agentscape-${environmentDefinition.id}.json`, scene);
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
