import './style.css';
import { WorldRuntime } from './runtime/WorldRuntime.js';
import { attachLegacyAuthoring } from './authoring/LegacyAuthoringShell.js';
import { SkillRegistry } from './skills/SkillRegistry.js';
import { registerCoreSkills } from './skills/registerCoreSkills.js';
import { AgentTools } from './agent/AgentTools.js';
import { ToolCallingAgent } from './agent/ToolCallingAgent.js';
import { HttpLLMGateway } from './agent/gateway/HttpLLMGateway.js';
import { bootstrapWorld } from './agent/bootstrapWorld.js';
import { LocalSceneStore } from './persistence/LocalSceneStore.js';
import { AutosaveController } from './persistence/AutosaveController.js';
import { RESOURCE_BUDGET } from './compiler/resourceBudget.js';
import { EditorController } from './editor/EditorController.js';
import { ENVIRONMENTS, resolveEnvironment } from './content/environments.js';
import { GenerationJobCenter, generationJobCenterMarkup } from './generation/GenerationJobCenter.js';

const QUICK_TASK_GROUPS = [
  {
    label:'常用操作',
    tasks:[
      { title:'拿起杯子', detail:'走近杯子并安全拿起', prompt:'让 agent_01 走到 cup_01 前并拿起杯子', tone:'primary' },
      { title:'放到桌上', detail:'拿起杯子，放到桌面并确认稳定', prompt:'让 agent_01 先拿起 cup_01，再把它放到 table_01 上并确认稳定', tone:'primary' },
      { title:'放下手中物体', detail:'原地释放并等待落稳', prompt:'让 agent_01 放下当前拿着的物体' },
      { title:'打开柜门', detail:'走近柜门并确认打开', prompt:'让 agent_01 走到 cabinet_01 前并打开柜门' },
      { title:'关闭柜门', detail:'走近柜门并确认关闭', prompt:'让 agent_01 走到 cabinet_01 前并关闭柜门' }
    ]
  },
  {
    label:'场景流程',
    tasks:[
      { title:'完整具身任务', detail:'开门 → 拿杯 → 放桌，全程验证', prompt:'让 agent_01 打开 cabinet_01，确认柜门完成打开后拿起 cup_01，再把杯子放到 table_01 上；每一步失败都不要继续后续动作', tone:'workflow' },
      { title:'建立咖啡角', detail:'让 Agent 自主规划场景流程', prompt:'建立一个咖啡角', tone:'workflow' }
    ]
  }
];

const quickTaskMarkup = () => QUICK_TASK_GROUPS.map((group) => `
  <section class="task-group">
    <div class="task-group-label">${group.label}</div>
    <div class="task-grid">
      ${group.tasks.map((task) => `<button class="task-card" data-prompt="${task.prompt}" data-tone="${task.tone || 'default'}"><strong>${task.title}</strong><span>${task.detail}</span></button>`).join('')}
    </div>
  </section>`).join('');

async function main() {
  const app = document.querySelector('#app');
  const environmentDefinition = resolveEnvironment(new URLSearchParams(location.search).get('world'));
  const environmentFactory = await environmentDefinition.load();
  const environmentOptions = ENVIRONMENTS.map((item) => `<option value="${item.id}"${item.id === environmentDefinition.id ? ' selected' : ''}>${item.number} · ${item.title}</option>`).join('');
  app.innerHTML = `
    <main class="shell" data-world="${environmentDefinition.id}">
      <header class="brandbar">
        <div class="brand-lockup"><strong>AgentScape</strong><span>${environmentDefinition.number} · ${environmentDefinition.title.toUpperCase()}</span></div>
        <div class="brand-actions"><select id="world-select" class="world-select" aria-label="World">${environmentOptions}</select><button id="cinematic-toggle" class="cinematic-toggle">沉浸</button><div class="status"><i></i> 实时</div></div>
      </header>
      <section class="workspace">
        <div id="viewport" class="viewport">
          <div class="editor-toolbar" aria-label="Scene editor tools">
            <button data-mode="translate" class="active">移动 <kbd>W</kbd></button>
            <button data-mode="rotate">旋转 <kbd>E</kbd></button>
            <span class="toolbar-divider"></span>
            <button id="duplicate">复制</button>
            <button id="delete" class="danger">删除</button>
            <details class="toolbar-more">
              <summary>场景</summary>
              <div class="toolbar-menu">
                <button id="undo" disabled>撤销 <kbd>⌘Z</kbd></button>
                <button id="redo" disabled>重做</button>
                <button id="save-scene">保存</button>
                <button id="load-scene">载入</button>
                <button id="export-scene">导出</button>
                <button id="import-scene">导入</button>
                <button id="reset-world" class="danger">重置世界</button>
              </div>
            </details>
            <input id="import-scene-file" type="file" accept="application/json,.json" hidden />
          </div>
          <div class="world-intro">
            <div class="world-kicker">${environmentDefinition.number} // ${environmentDefinition.title.toUpperCase()}</div>
            <h2>${environmentDefinition.headline}</h2>
            <p>${environmentDefinition.description}</p>
            <div class="world-facts">${environmentDefinition.facts.map((fact) => `<span>${fact}</span>`).join('')}</div>
          </div>
          <div class="hint">点击选择 · 拖拽 Gizmo 编辑 · W 移动 · E 旋转</div>
        </div>
        <aside class="panel" data-view="agent">
          <nav class="panel-tabs" aria-label="工作台视图">
            <button type="button" data-panel-view="agent" class="active" aria-selected="true">任务</button>
            <button type="button" data-panel-view="generation" aria-selected="false">生成</button>
            <button type="button" data-panel-view="inspect" aria-selected="false">对象</button>
          </nav>
          <section class="inspector">
            <div class="inspector-heading"><div><div class="eyebrow">对象</div><strong>场景属性</strong></div><span class="inspector-hint">点击场景中的对象</span></div>
            <div id="empty-selection" class="empty-selection">选择一个物体后，这里会显示位置、关系与可执行动作。</div>
            <div id="selection" class="selection hidden">
              <div class="object-title"><h1 id="object-id"></h1><span id="object-type"></span></div>
              <dl class="properties">
                <div><dt>资产</dt><dd id="asset-id"></dd></div>
                <div><dt>位置</dt><dd id="position"></dd></div>
                <div><dt>旋转</dt><dd id="rotation"></dd></div>
              </dl>
              <div id="spatial-info" class="spatial-info"></div>
              <div id="relation-info" class="relation-info"></div>
              <div id="actions" class="action-list"></div>
            </div>
          </section>
          ${generationJobCenterMarkup()}
          <section class="agent-console">
            <div class="console-heading">
              <div><div class="eyebrow">任务</div><h2>你想让世界做什么？</h2></div>
              <span id="agent-mode" class="agent-mode">OFF</span>
            </div>
            <div id="task-state" class="task-state" data-state="ready" role="status" aria-live="polite">
              <span class="task-state-dot"></span>
              <div><strong id="task-state-label">准备好了</strong><span id="task-state-detail">选择一个常用操作，或在下方直接描述任务。</span></div>
            </div>
            <div class="agent-scroll">
              <div class="quick-tasks">${quickTaskMarkup()}</div>
              <details class="activity-panel">
                <summary><span>运行记录</span><small id="activity-count">0</small></summary>
                <div id="log" class="log"></div>
              </details>
              <details class="developer-tools">
                <summary><span>高级设置</span><small>Gateway · Validation · Assets</small></summary>
                <div class="developer-tools-body">
                  <details class="gateway-settings">
                    <summary>LLM Gateway</summary>
                    <label>Endpoint<input id="gateway-endpoint" type="url" placeholder="https://your-server.example/agent" /></label>
                    <small>只保存 Gateway URL，不在浏览器保存模型 API Key。留空时 Agent 规划不可用；不会回退到本地硬编码 planner。</small>
                  </details>
                  <details class="gateway-settings engine-settings">
                    <summary>Engine / Validation</summary>
                    <div class="engine-actions"><button id="validate-world">Validate</button><button id="repair-world">Repair</button><button id="verify-trace">Verify Trace</button></div>
                    <div id="engine-report" class="engine-report">Engine ready.</div>
                  </details>
                  <details class="gateway-settings compiler-settings">
                    <summary>Agent-Ready Asset Compiler</summary>
                    <div class="asset-search"><input id="compiler-url" type="url" placeholder="https://.../model.glb" /><button id="compile-url-button">Compile URL</button></div>
                    <div class="compiler-file-row"><input id="compiler-file" type="file" accept=".glb,model/gltf-binary" /><button id="compile-file-button">Compile File</button></div>
                    <label>Compiler Endpoint<input id="compiler-endpoint" type="url" placeholder="https://your-server.example/compile" /></label>
                    <small>未配置后端时使用浏览器本地检查；重型碰撞/视觉语义交给 Compiler Provider。</small>
                    <div id="compiler-report" class="engine-report">No asset compiled yet.</div>
                  </details>
                  <details class="gateway-settings asset-settings">
                    <summary>Asset Library / Generator</summary>
                    <div class="asset-search"><input id="asset-query" placeholder="搜索 chair / 椅子 / cup" /><button id="asset-search-button">Search</button></div>
                    <div id="asset-results" class="asset-results"></div>
                    <label>Generator Endpoint<input id="asset-generator-endpoint" type="url" placeholder="https://your-server.example/generate-3d" /></label>
                    <small>搜索不到时才应进入生成链。</small>
                  </details>
                </div>
              </details>
            </div>
            <form id="command" class="command">
              <input id="input" autocomplete="off" placeholder="告诉 Agent 你想完成什么…" aria-label="Agent task" />
              <button type="submit"><span>发送</span></button>
            </form>
          </section>
        </aside>
      </section>
    </main>`;

  const logEl = document.querySelector('#log');
  const activityCountEl = document.querySelector('#activity-count');
  let activityCount = 0;
  const log = (text, kind = '') => {
    const row = document.createElement('div');
    row.className = `log-row ${kind}`;
    row.textContent = text;
    logEl.append(row);
    while (logEl.children.length > 80) logEl.firstElementChild.remove();
    if (activityPanel?.open) {
      activityCount = 0;
      activityCountEl.textContent = '0';
      logEl.scrollTop = logEl.scrollHeight;
    } else {
      activityCount += 1;
      activityCountEl.textContent = String(Math.min(activityCount, 99));
    }
  };

  const taskState = document.querySelector('#task-state');
  const taskStateLabel = document.querySelector('#task-state-label');
  const taskStateDetail = document.querySelector('#task-state-detail');
  const commandForm = document.querySelector('#command');
  const commandInput = document.querySelector('#input');
  const commandButton = commandForm.querySelector('button[type="submit"]');
  const commandButtonLabel = commandButton.querySelector('span');
  const taskButtons = [...document.querySelectorAll('.task-card')];
  const activityPanel = document.querySelector('.activity-panel');
  let taskBusy = false;
  let activeTaskButton = null;
  const setTaskState = (state, label, detail) => {
    taskState.dataset.state = state;
    taskStateLabel.textContent = label;
    taskStateDetail.textContent = detail;
  };
  const setTaskBusy = (busy, sourceButton = null) => {
    taskBusy = busy;
    activeTaskButton?.classList.remove('is-running');
    activeTaskButton = busy ? sourceButton : null;
    activeTaskButton?.classList.add('is-running');
    for (const button of taskButtons) button.disabled = busy;
    commandInput.readOnly = busy;
    commandButton.disabled = busy;
    commandButtonLabel.textContent = busy ? '处理中' : '发送';
    taskState.setAttribute('aria-busy', busy ? 'true' : 'false');
  };
  activityPanel.addEventListener('toggle', () => {
    if (!activityPanel.open) return;
    activityCount = 0;
    activityCountEl.textContent = '0';
    requestAnimationFrame(() => { logEl.scrollTop = logEl.scrollHeight; });
  });

  const world = new WorldRuntime(document.querySelector('#viewport'), { environmentFactory });
  const authoring = attachLegacyAuthoring(world);
  world.skills = registerCoreSkills(new SkillRegistry({ policy: world.policy, trace: world.trace, runtime: world }), world);
  await authoring.initialize({ pair: true });
  await world.init();
  const tools = new AgentTools(world, { profile:'builder', actor:'agent_01' });
  const gateway = new HttpLLMGateway({ endpoint: localStorage.getItem('agentscape.gatewayEndpoint') || '' });
  const agent = new ToolCallingAgent({ tools, gateway, log });
  const editor = new EditorController(world);
  const shell = document.querySelector('.shell');
  const panel = document.querySelector('.panel');
  const panelTabs = [...document.querySelectorAll('[data-panel-view]')];
  const setPanelView = (view) => {
    panel.dataset.view = view;
    for (const tab of panelTabs) {
      const active = tab.dataset.panelView === view;
      tab.classList.toggle('active', active);
      tab.setAttribute('aria-selected', active ? 'true' : 'false');
    }
    requestAnimationFrame(() => world.resize());
  };
  panelTabs.forEach((tab) => tab.addEventListener('click', () => setPanelView(tab.dataset.panelView)));
  const generationJobCenter = await new GenerationJobCenter({ root:panel, world, tools, log }).init();
  document.querySelector('#world-select').addEventListener('change', (event) => {
    const url = new URL(location.href);
    url.searchParams.set('world', event.target.value);
    location.href = url.toString();
  });
  const cinematicButton = document.querySelector('#cinematic-toggle');
  cinematicButton.addEventListener('click', () => {
    const enabled = shell.classList.toggle('cinematic');
    cinematicButton.textContent = enabled ? '编辑' : '沉浸';
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
  world.events.on('editor.selection', ({ id }) => { renderInspector(id); if (id) setPanelView('inspect'); });
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
    const inspectorTab = document.querySelector('[data-panel-view="inspect"]');
    inspectorTab.classList.toggle('has-selection', Boolean(id));
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
      button.textContent = ({open:'打开',close:'关闭',pickup:'拿起',drop:'放下'})[action] || action;
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
    modeBadge.textContent = gateway.isConfigured() ? 'LLM' : 'OFF';
    modeBadge.classList.toggle('live', gateway.isConfigured());
  };
  updateAgentMode();
  gatewayInput.addEventListener('change', () => {
    gateway.setEndpoint(gatewayInput.value);
    if (gateway.endpoint) localStorage.setItem('agentscape.gatewayEndpoint', gateway.endpoint);
    else localStorage.removeItem('agentscape.gatewayEndpoint');
    updateAgentMode();
    log(gateway.isConfigured() ? `LLM gateway: ${gateway.endpoint}` : 'LLM gateway disabled; Agent planning is unavailable', 'result');
  });

  async function execute(prompt, label = '自定义任务', sourceButton = null) {
    if (taskBusy) return;
    setTaskBusy(true, sourceButton);
    setTaskState('running', '正在处理', label);
    try {
      const result = await agent.run(prompt);
      if (result.taskStatus === 'completed') {
        setTaskState('success', '已完成', `${label} · Runtime 已验证`);
        log('task status: completed · mutation chain verified', 'result');
      } else {
        const tool = result.lastMutation?.tool || 'mutation';
        const outcome = result.lastMutation?.outcome?.state || 'unknown';
        setTaskState('error', '未完成', `${label} · ${tool} → ${outcome}`);
        log(`task status: incomplete · ${tool} → ${outcome}`, 'error');
      }
      return result;
    } catch (err) {
      setTaskState('error', '遇到问题', err.message);
      log(`error: ${err.message}`, 'error');
      return null;
    } finally {
      setTaskBusy(false);
    }
  }

  taskButtons.forEach((button) => button.addEventListener('click', () => {
    const label = button.querySelector('strong')?.textContent || '快捷任务';
    setPanelView('agent');
    execute(button.dataset.prompt, label, button);
  }));
  commandForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const value = commandInput.value.trim();
    if (!value || taskBusy) return;
    commandInput.value = '';
    setPanelView('agent');
    await execute(value, value.length > 42 ? `${value.slice(0, 42)}…` : value);
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

  const resetWorldButton = document.querySelector('#reset-world');
  let resetWorldArmed = false;
  let resetWorldTimer = null;
  resetWorldButton.addEventListener('click', async () => {
    if (!resetWorldArmed) {
      resetWorldArmed = true;
      resetWorldButton.textContent = 'Confirm reset';
      resetWorldTimer = setTimeout(() => {
        resetWorldArmed = false;
        resetWorldButton.textContent = 'Reset world';
      }, 3000);
      return;
    }
    clearTimeout(resetWorldTimer);
    resetWorldArmed = false;
    resetWorldButton.textContent = 'Resetting…';
    resetWorldButton.disabled = true;
    try {
      editor.select(null);
      sceneStore.clear();
      await world.clearObjects();
      await bootstrapWorld(tools, environmentDefinition.bootstrap);
      world.history.clear();
      setTaskState('ready', '世界已重置', '已恢复官方初始场景，可以重新测试拿杯子、放置和柜门任务。');
      log(`world reset · ${world.listObjects().length} objects`, 'result');
    } catch (error) {
      setTaskState('error', '重置失败', error.message);
      log(`reset error: ${error.message}`, 'error');
    } finally {
      resetWorldButton.disabled = false;
      resetWorldButton.textContent = 'Reset world';
    }
  });

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
