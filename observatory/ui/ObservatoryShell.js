export class ObservatoryShell {
  constructor(root) {
    this.root = root;
    this.scenarioIndexById = new Map();
    root.innerHTML = `
      <div class="obs-app">
        <div class="obs-bg" aria-hidden="true"><i></i><i></i></div>

        <header class="obs-topbar">
          <div class="obs-topbar-left">
            <a class="obs-brand" href="/observatory/" aria-label="AgentScape 工作台">
              <span class="obs-brand-dot" aria-hidden="true"></span>
              <div class="obs-brand-copy">
                <strong>AgentScape 工作台</strong>
                <span id="obs-lab-title">观测台 · 运行时验证</span>
              </div>
            </a>
            <div class="obs-context" aria-label="实验上下文">
              <label class="obs-context-field">
                <span>实验模块</span>
                <select id="obs-lab-select" aria-label="Lab"></select>
              </label>
              <label class="obs-context-field">
                <span>仿真后端</span>
                <select id="obs-backend-select" aria-label="Backend"></select>
              </label>
            </div>
          </div>
          <div class="obs-topbar-right">
            <button id="obs-focus-view" class="obs-top-action" type="button" title="聚焦当前场景" aria-label="聚焦当前场景">
              ${icon("focus")}
              <span>聚焦</span>
            </button>
            <a class="obs-studio-link" href="/">${icon("terminal")}<span>工作室</span></a>
            <i class="obs-top-separator" aria-hidden="true"></i>
            <button class="obs-top-icon" type="button" data-open-right="layers" title="调试图层" aria-label="打开 调试图层">${icon("settings")}</button>
            <button class="obs-top-icon" type="button" data-open-right="inspect" title="运行时检视" aria-label="打开运行时检视">${icon("help")}</button>
          </div>
        </header>

        <main class="obs-workspace">
          <aside class="obs-left-sidebar obs-glass" aria-label="实验场景">
            <button id="obs-scenarios-toggle" class="obs-edge-toggle obs-edge-toggle-right" type="button" aria-label="显示或隐藏场景面板" aria-pressed="true">${icon("chevron-left")}</button>
            <div class="obs-sidebar-head">
              <strong>运行图</strong>
              <span>实时执行</span>
            </div>
            <div id="obs-scenario-list" class="obs-scenario-list"></div>
          </aside>

          <section class="obs-center-column" aria-label="运行时视口">
            <div class="obs-center-toolbar">
              <div class="obs-view-tabs" role="tablist" aria-label="视图模式">
                <button class="obs-view-tab is-active" type="button" data-view="world" aria-label="真实世界">${icon("world")}<span>真实世界 <b>世界</b></span></button>
                <button class="obs-view-tab" type="button" data-view="evidence" aria-label="运行证据">${icon("evidence")}<span>运行证据 <b>证据</b></span></button>
                <button class="obs-view-tab" type="button" data-view="inspect" aria-label="运行时检视">${icon("cube")}<span>运行时检视 <b>检视</b></span></button>
              </div>
              <div class="obs-fixed-pill"><i></i><span>仿真 · 固定 60 HZ</span></div>
            </div>

            <section class="obs-stage obs-glass" aria-label="运行时 3D 世界">
              <div id="obs-viewport" class="obs-viewport"></div>
              <div class="obs-stage-wash" aria-hidden="true"></div>
              <button class="obs-stage-title" id="obs-scenario-badge" type="button" aria-expanded="false" aria-label="查看当前场景详情"></button>
              <div class="obs-focus-reticle" aria-hidden="true"><i></i><i></i><i></i><i></i></div>
              <div id="obs-status-layer" class="obs-status-layer" hidden>
                <div class="obs-spinner" aria-hidden="true"></div>
                <span id="obs-status-text">正在加载实验…</span>
                <button id="obs-status-action" class="obs-status-action" type="button" hidden>重新加载</button>
              </div>
            </section>
          </section>

          <aside class="obs-right-sidebar obs-glass" aria-label="验证与检视">
            <button id="obs-results-toggle" class="obs-edge-toggle obs-edge-toggle-left" type="button" aria-label="显示或隐藏验证面板" aria-pressed="true">${icon("chevron-right")}</button>
            <div class="obs-right-tabs" role="tablist" aria-label="右侧工具">
              <button class="obs-right-tab is-active" type="button" data-right-tab="run">${icon("flow")}<span>执行流</span></button>
              <button id="obs-tools-tab" class="obs-right-tab" type="button" data-right-tab="tools" hidden>${icon("terminal")}<span>工具</span></button>
              <button class="obs-right-tab" type="button" data-right-tab="layers">${icon("layers")}<span>图层</span></button>
              <button class="obs-right-tab" type="button" data-right-tab="inspect">${icon("info")}<span>检视</span></button>
            </div>

            <div class="obs-right-body">
              <section class="obs-right-panel is-active" data-right-panel="run">
                <div class="obs-run-summary">
                  <div><span>验证</span><strong>当前执行流</strong></div>
                  <span id="obs-result-summary" class="obs-result-summary is-neutral">—</span>
                </div>
                <div class="obs-run-graph">
                  <div class="obs-flow-line" aria-hidden="true"></div>
                  <article class="obs-flow-node obs-flow-scenario">
                    <div class="obs-flow-dot">${icon("assignment")}</div>
                    <div class="obs-flow-content">
                      <span class="obs-flow-kicker">场景</span>
                      <div id="obs-run-scenario-card" class="obs-flow-card"><strong>等待场景</strong><small>选择一个运行时验证任务</small></div>
                    </div>
                  </article>
                  <div id="obs-assertions" class="obs-assertions"></div>
                </div>
              </section>

              <section class="obs-right-panel obs-tool-panel" data-right-panel="tools">
                <div class="obs-panel-heading"><span>AGENT TOOLS</span><strong>工具工作台</strong><small>选择真实领域工具，编辑参数并查看调用结果。</small></div>
                <label class="obs-tool-search">
                  ${icon("search")}
                  <input id="obs-tool-search" type="search" placeholder="搜索工具或能力…" autocomplete="off" />
                </label>
                <div id="obs-tool-list" class="obs-tool-list" role="listbox" aria-label="可用智能体工具"></div>
                <div class="obs-tool-detail">
                  <div class="obs-tool-detail-head">
                    <div><span>当前工具</span><strong id="obs-tool-name">—</strong></div>
                    <span id="obs-tool-required" class="obs-tool-required">无必填参数</span>
                  </div>
                  <p id="obs-tool-description">选择一个工具以查看定义。</p>
                  <label class="obs-tool-args-label" for="obs-tool-args">调用参数 <small>JSON</small></label>
                  <textarea id="obs-tool-args" class="obs-tool-args" rows="7" spellcheck="false">{}</textarea>
                  <div id="obs-tool-error" class="obs-tool-error" role="alert" hidden></div>
                  <button id="obs-tool-invoke" class="obs-tool-invoke" type="button" disabled>${icon("play")}<span>调用工具</span><small>⌘ ↵</small></button>
                </div>
                <section class="obs-tool-output" aria-live="polite">
                  <div class="obs-tool-section-title"><span>最近响应</span><b id="obs-tool-outcome">等待调用</b></div>
                  <pre id="obs-tool-result">选择工具并发起调用，结果会显示在这里。</pre>
                </section>
                <section class="obs-tool-history-section">
                  <div class="obs-tool-section-title"><span>调用历史</span><button id="obs-tool-clear" type="button">清空</button></div>
                  <div id="obs-tool-history" class="obs-tool-history"><div class="obs-empty">暂无手动调用</div></div>
                </section>
              </section>

              <section class="obs-right-panel" data-right-panel="layers">
                <div class="obs-panel-heading"><span>调试视图</span><strong>视觉图层</strong><small>只改变观测方式，不改变 Runtime 真值。</small></div>
                <div class="obs-debug-controls">
                  ${debugToggle("native", "native-debug", "原生物理")}
                  ${debugToggle("manifest", "manifest-debug", "清单碰撞体")}
                  ${debugToggle("difference", "difference-debug", "真值差异")}
                  ${debugToggle("normalized", "normalized-debug", "归一化碰撞体")}
                  ${debugToggle("velocity", "velocity-debug", "速度")}
                  ${debugToggle("joint", "joint-debug", "关节坐标系")}
                  ${debugToggle("contact", "contact-debug", "接触法线")}
                  ${debugToggle("bounds", "bounds-debug", "边界 / 重叠")}
                  ${debugToggle("ray", "ray-debug", "射线 / 命中")}
                  ${debugToggle("spatial-query", "spatial-query-debug", "空间查询")}
                  ${debugToggle("navmesh", "navmesh-debug", "NavMesh")}
                  ${debugToggle("path", "path-debug", "Path")}
                  ${debugToggle("endpoints", "endpoints-debug", "Start / End")}
                  ${debugToggle("obstacles", "obstacles-debug", "动态障碍物")}
                  ${debugToggle("interaction-los", "interaction-los-debug", "视线 / 命中")}
                  ${debugToggle("interaction-support", "interaction-support-debug", "支撑面")}
                  ${debugToggle("interaction-state", "interaction-state-debug", "交互状态")}
                  ${debugToggle("agent-tool", "agent-tool-debug", "工具结果")}
                  ${debugToggle("labels", "labels-debug", "世界标签")}
                  ${debugToggle("grid", "grid-debug", "网格 / 坐标轴")}
                </div>
              </section>

              <section class="obs-right-panel" data-right-panel="inspect">
                <div class="obs-panel-heading"><span>运行时</span><strong>运行时检视</strong><small>关键状态、测量与后端观测值。</small></div>
                <div id="obs-inspector" class="obs-inspector"></div>
                <div class="obs-metrics-title"><span>测量</span><strong>测量数据</strong></div>
                <div id="obs-metrics" class="obs-metrics"></div>
                <div class="obs-metrics-title"><span>WebGPU</span><strong>Compute Probe</strong></div>
                <div class="obs-compute-probe">
                  <button id="obs-compute-probe" type="button">运行 Compute Probe</button>
                  <pre id="obs-compute-probe-result">尚未运行。仅验证当前 WebGPU renderer 的 storage buffer / compute / readback。</pre>
                  <button id="obs-spatial-probe" type="button">运行 Spatial Probe</button><button id="obs-resident-culling-probe" type="button">显示 GPU Culling</button><button id="obs-indirect-draw-probe" type="button">显示 Indirect Draw</button><button id="obs-compaction-probe" type="button">显示 GPU Compaction</button>
                  <pre id="obs-spatial-probe-result">尚未运行。GPU 与 CPU 将对同一批位置做距离阈值筛选并逐项比对。</pre>
                </div>
              </section>
            </div>
          </aside>
        </main>

        <div class="obs-bottom-dock" aria-label="实验控制">
          <div class="obs-commandbar obs-glass-elevated">
            <button id="obs-run" class="obs-primary" type="button">${icon("play")}<span>运行</span><small>空格</small></button>
            <button id="obs-step" type="button">${icon("step")}<span>单步</span></button>
            <button id="obs-step10" type="button"><b>+10</b><span>帧</span></button>
            <i class="obs-dock-divider" aria-hidden="true"></i>
            <button id="obs-reset" class="obs-danger" type="button">${icon("reset")}<span>重置</span></button>
            <details class="obs-more">
              <summary aria-label="更多控制">${icon("more")}</summary>
              <div class="obs-more-menu obs-glass-elevated">
                <button id="obs-checkpoint" type="button">记录检查点</button>
                <button id="obs-restore" type="button" disabled>重放到检查点</button>
                <span>记录帧：<b id="obs-checkpoint-frame">—</b></span>
              </div>
            </details>
          </div>
          <div class="obs-sim-strip obs-glass-elevated">
            <span><small>帧</small><b id="obs-frame">0</b></span>
            <i></i>
            <span><small>仿真</small><b id="obs-time">0.000 s</b></span>
            <i></i>
            <span class="obs-active-op"><em></em><b id="obs-active-action">idle</b></span>
          </div>
        </div>
      </div>`;

    this.refs = Object.fromEntries([
      "run", "step", "step10", "reset", "checkpoint", "restore", "checkpoint-frame", "frame", "time", "active-action", "scenario-list", "viewport",
      "scenario-badge", "status-layer", "status-text", "status-action", "result-summary", "run-scenario-card", "inspector", "native-debug", "manifest-debug", "difference-debug", "normalized-debug", "velocity-debug", "joint-debug", "contact-debug", "bounds-debug", "ray-debug", "spatial-query-debug", "navmesh-debug", "path-debug", "endpoints-debug", "obstacles-debug", "interaction-los-debug", "interaction-support-debug", "interaction-state-debug", "agent-tool-debug", "labels-debug", "grid-debug", "assertions", "metrics",
      "lab-title", "lab-select", "backend-select", "focus-view", "scenarios-toggle", "results-toggle",
      "tools-tab", "tool-search", "tool-list", "tool-name", "tool-required", "tool-description", "tool-args", "tool-error", "tool-invoke", "tool-outcome", "tool-result", "tool-clear", "tool-history", "resident-culling-probe", "indirect-draw-probe", "compaction-probe", "compute-probe", "compute-probe-result", "spatial-probe", "spatial-probe-result"
    ].map((name) => [name, root.querySelector(`#obs-${name}`)]));

    this.toolDefinitions = [];
    this.toolHistory = [];
    this.activeToolName = null;
    this.onToolInvoke = null;

    this.refs["scenarios-toggle"].addEventListener("click", () => this.togglePanel("scenarios"));
    this.refs["results-toggle"].addEventListener("click", () => this.togglePanel("results"));
    this.root.querySelectorAll("[data-right-tab]").forEach((button) => button.addEventListener("click", () => this.setRightTab(button.dataset.rightTab)));
    this.root.querySelectorAll("[data-open-right]").forEach((button) => button.addEventListener("click", () => {
      this.setPanelVisible("results", true);
      this.setRightTab(button.dataset.openRight);
    }));
    this.root.querySelector('[data-view="evidence"]').addEventListener("click", () => { this.setPanelVisible("results", true); this.setRightTab("run"); });
    this.root.querySelector('[data-view="inspect"]').addEventListener("click", () => { this.setPanelVisible("results", true); this.setRightTab("inspect"); });
    this.root.querySelector('[data-view="world"]').addEventListener("click", () => this.refs["focus-view"].click());
    this.root.querySelectorAll("[data-view]").forEach((button) => button.addEventListener("click", () => {
      this.root.querySelectorAll("[data-view]").forEach((item) => item.classList.toggle("is-active", item === button));
    }));
    this.refs["tool-search"].addEventListener("input", () => this.renderToolList());
    this.refs["tool-invoke"].addEventListener("click", () => this.invokeSelectedTool());
    this.refs["tool-args"].addEventListener("keydown", (event) => {
      if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
        event.preventDefault();
        this.invokeSelectedTool();
      }
    });
    this.refs["tool-clear"].addEventListener("click", () => {
      this.toolHistory = [];
      this.renderToolHistory();
    });
    const scenarioBadge = this.refs["scenario-badge"];
    const setScenarioBadgeExpanded = (expanded) => {
      scenarioBadge.classList.toggle("is-expanded", expanded);
      scenarioBadge.setAttribute("aria-expanded", String(expanded));
    };
    scenarioBadge.addEventListener("mouseenter", () => setScenarioBadgeExpanded(true));
    scenarioBadge.addEventListener("mouseleave", () => setScenarioBadgeExpanded(false));
    scenarioBadge.addEventListener("focus", () => setScenarioBadgeExpanded(true));
    scenarioBadge.addEventListener("blur", () => setScenarioBadgeExpanded(false));
    scenarioBadge.addEventListener("click", () => setScenarioBadgeExpanded(!scenarioBadge.classList.contains("is-expanded")));
    if (matchMedia("(max-width: 1040px)").matches) this.setPanelVisible("results", false);
    if (matchMedia("(max-width: 760px)").matches) this.setPanelVisible("scenarios", false);
  }

  setRightTab(tab) {
    this.root.querySelectorAll("[data-right-tab]").forEach((button) => button.classList.toggle("is-active", button.dataset.rightTab === tab));
    this.root.querySelectorAll("[data-right-panel]").forEach((panel) => panel.classList.toggle("is-active", panel.dataset.rightPanel === tab));
  }

  configureToolWorkbench(definitions = [], onInvoke = null, preferredToolName = null) {
    this.toolDefinitions = [...definitions].sort((a, b) => a.name.localeCompare(b.name));
    this.onToolInvoke = onInvoke;
    const visible = this.toolDefinitions.length > 0;
    this.refs["tools-tab"].hidden = !visible;
    this.root.classList.toggle("obs-has-tool-workbench", visible);
    if (!visible) {
      this.activeToolName = null;
      if (this.root.querySelector('[data-right-tab="tools"]')?.classList.contains("is-active")) this.setRightTab("run");
      return;
    }
    const preferred = this.toolDefinitions.some((item) => item.name === preferredToolName) ? preferredToolName : null;
    const selected = preferred || (this.toolDefinitions.some((item) => item.name === this.activeToolName)
      ? this.activeToolName
      : this.toolDefinitions[0].name);
    this.selectTool(selected);
  }

  renderToolList() {
    const query = this.refs["tool-search"].value.trim().toLowerCase();
    const filtered = this.toolDefinitions.filter((definition) => `${definition.name} ${definition.description || ""}`.toLowerCase().includes(query));
    this.refs["tool-list"].replaceChildren(...filtered.map((definition) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = `obs-tool-item${definition.name === this.activeToolName ? " is-active" : ""}`;
      button.setAttribute("role", "option");
      button.setAttribute("aria-selected", String(definition.name === this.activeToolName));
      const required = definition.parameters?.required?.length || 0;
      button.innerHTML = `<span>${escapeHtml(definition.name)}</span><small>${required ? `${required} 必填` : "无必填"}</small>`;
      button.addEventListener("click", () => this.selectTool(definition.name));
      return button;
    }));
    if (!filtered.length) this.refs["tool-list"].innerHTML = `<div class="obs-empty">没有匹配的工具</div>`;
  }

  selectTool(name) {
    const definition = this.toolDefinitions.find((item) => item.name === name);
    if (!definition) return;
    this.activeToolName = name;
    this.refs["tool-name"].textContent = definition.name;
    this.refs["tool-description"].textContent = definition.description || "该工具没有提供说明。";
    const required = definition.parameters?.required || [];
    this.refs["tool-required"].textContent = required.length ? `必填：${required.join(" · ")}` : "无必填参数";
    this.refs["tool-args"].value = JSON.stringify(toolArgumentTemplate(definition.parameters), null, 2);
    this.refs["tool-error"].hidden = true;
    this.refs["tool-invoke"].disabled = false;
    this.renderToolList();
  }

  async invokeSelectedTool() {
    if (!this.activeToolName || !this.onToolInvoke || this.refs["tool-invoke"].disabled) return;
    let args;
    try {
      args = JSON.parse(this.refs["tool-args"].value || "{}");
      if (!args || Array.isArray(args) || typeof args !== "object") throw new Error("参数必须是 JSON 对象");
    } catch (error) {
      this.refs["tool-error"].textContent = `参数格式错误：${error.message}`;
      this.refs["tool-error"].hidden = false;
      return;
    }
    this.refs["tool-error"].hidden = true;
    this.refs["tool-invoke"].disabled = true;
    this.refs["tool-invoke"].classList.add("is-running");
    this.refs["tool-invoke"].querySelector("span").textContent = "正在调用…";
    const startedAt = performance.now();
    try {
      const payload = await this.onToolInvoke(this.activeToolName, args);
      const elapsedMs = payload?.elapsedMs ?? performance.now() - startedAt;
      const outcome = payload?.policy?.outcome?.state || "accepted";
      this.refs["tool-outcome"].textContent = `${outcome} · ${elapsedMs.toFixed(1)} ms`;
      this.refs["tool-outcome"].dataset.tone = payload?.policy?.outcome?.verified === false ? "warn" : "pass";
      this.refs["tool-result"].textContent = JSON.stringify(payload?.result ?? null, null, 2);
      this.toolHistory.unshift({ name: this.activeToolName, args, result: payload?.result, outcome, elapsedMs, ok: true, time: new Date() });
    } catch (error) {
      const elapsedMs = performance.now() - startedAt;
      this.refs["tool-outcome"].textContent = `${error.code || "error"} · ${elapsedMs.toFixed(1)} ms`;
      this.refs["tool-outcome"].dataset.tone = "fail";
      this.refs["tool-result"].textContent = JSON.stringify({ error: error.message, code: error.code || null }, null, 2);
      this.toolHistory.unshift({ name: this.activeToolName, args, error: error.message, outcome: error.code || "error", elapsedMs, ok: false, time: new Date() });
    } finally {
      this.toolHistory = this.toolHistory.slice(0, 12);
      this.renderToolHistory();
      this.refs["tool-invoke"].disabled = false;
      this.refs["tool-invoke"].classList.remove("is-running");
      this.refs["tool-invoke"].querySelector("span").textContent = "调用工具";
    }
  }

  renderToolHistory() {
    if (!this.toolHistory.length) {
      this.refs["tool-history"].innerHTML = `<div class="obs-empty">暂无手动调用</div>`;
      return;
    }
    this.refs["tool-history"].innerHTML = this.toolHistory.map((entry) => `<article class="obs-tool-history-item ${entry.ok ? "is-pass" : "is-fail"}">
      <i></i><div><strong>${escapeHtml(entry.name)}</strong><small>${escapeHtml(entry.outcome)} · ${entry.elapsedMs.toFixed(1)} ms · ${entry.time.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</small></div>
    </article>`).join("");
  }

  setPanelVisible(panel, visible) {
    const isScenarios = panel === "scenarios";
    const className = isScenarios ? "obs-hide-scenarios" : "obs-hide-results";
    const ref = this.refs[isScenarios ? "scenarios-toggle" : "results-toggle"];
    this.root.classList.toggle(className, !visible);
    ref.setAttribute("aria-pressed", String(visible));
    ref.innerHTML = icon(isScenarios ? (visible ? "chevron-left" : "chevron-right") : (visible ? "chevron-right" : "chevron-left"));
  }

  togglePanel(panel) {
    const isScenarios = panel === "scenarios";
    const className = isScenarios ? "obs-hide-scenarios" : "obs-hide-results";
    const willShow = this.root.classList.contains(className);
    if (willShow && matchMedia("(max-width: 1040px)").matches) this.setPanelVisible(isScenarios ? "results" : "scenarios", false);
    this.setPanelVisible(panel, willShow);
  }

  bind({ onRun, onStep, onStep10, onReset, onCheckpoint, onRestore, onResidentCullingProbe, onIndirectDrawProbe, onCompactionProbe, onNativeDebug, onManifestDebug, onDifferenceDebug, onNormalizedDebug, onVelocityDebug, onJointDebug, onContactDebug, onBoundsDebug, onRayDebug, onSpatialQueryDebug, onNavMeshDebug, onPathDebug, onEndpointsDebug, onObstaclesDebug, onInteractionLosDebug, onInteractionSupportDebug, onInteractionStateDebug, onAgentToolDebug, onLabelsDebug, onGridDebug, onFocusView, onComputeProbe, onSpatialProbe, onLabChange, onBackendChange }) {
    this.refs.run.addEventListener("click", onRun);
    this.refs.step.addEventListener("click", onStep);
    this.refs.step10.addEventListener("click", onStep10);
    this.refs.reset.addEventListener("click", onReset);
    this.refs.checkpoint.addEventListener("click", onCheckpoint);
    this.refs.restore.addEventListener("click", onRestore);
    this.refs["resident-culling-probe"]?.addEventListener("click", () => onResidentCullingProbe?.());
    this.refs["indirect-draw-probe"]?.addEventListener("click", () => onIndirectDrawProbe?.());
    this.refs["compaction-probe"]?.addEventListener("click", () => onCompactionProbe?.());
    const bindToggle = (name, handler) => this.refs[name].addEventListener("change", (event) => handler?.(event.target.checked));
    bindToggle("native-debug", onNativeDebug);
    bindToggle("manifest-debug", onManifestDebug);
    bindToggle("difference-debug", onDifferenceDebug);
    bindToggle("normalized-debug", onNormalizedDebug);
    bindToggle("velocity-debug", onVelocityDebug);
    bindToggle("joint-debug", onJointDebug);
    bindToggle("contact-debug", onContactDebug);
    bindToggle("bounds-debug", onBoundsDebug);
    bindToggle("ray-debug", onRayDebug);
    bindToggle("spatial-query-debug", onSpatialQueryDebug);
    bindToggle("navmesh-debug", onNavMeshDebug);
    bindToggle("path-debug", onPathDebug);
    bindToggle("endpoints-debug", onEndpointsDebug);
    bindToggle("obstacles-debug", onObstaclesDebug);
    bindToggle("interaction-los-debug", onInteractionLosDebug);
    bindToggle("interaction-support-debug", onInteractionSupportDebug);
    bindToggle("interaction-state-debug", onInteractionStateDebug);
    bindToggle("agent-tool-debug", onAgentToolDebug);
    bindToggle("labels-debug", onLabelsDebug);
    bindToggle("grid-debug", onGridDebug);
    this.refs["focus-view"].addEventListener("click", () => onFocusView?.());
    this.refs["compute-probe"].addEventListener("click", () => onComputeProbe?.());
    this.refs["spatial-probe"].addEventListener("click", () => onSpatialProbe?.());
    this.refs["lab-select"].addEventListener("change", (event) => onLabChange?.(event.target.value));
    this.refs["backend-select"].addEventListener("change", (event) => onBackendChange?.(event.target.value));
  }

  setComputeProbeAvailability(available) {
    this.refs["compute-probe"].disabled = !available;
    this.refs["spatial-probe"].disabled = !available;
    if (!available) {
      this.refs["compute-probe-result"].textContent = "当前 renderer 不是 WebGPU；Compute Probe 不会在 WebGL2 fallback 上运行。";
      this.refs["spatial-probe-result"].textContent = "当前 renderer 不是 WebGPU；Spatial Probe 不会在 WebGL2 fallback 上运行。";
    }
    else if (this.refs["compute-probe-result"].textContent.includes("不是 WebGPU")) this.refs["compute-probe-result"].textContent = "尚未运行。仅验证当前 WebGPU renderer 的 storage buffer / compute / readback。";
  }

  setComputeProbeRunning(running) {
    this.refs["compute-probe"].disabled = Boolean(running);
    this.refs["compute-probe"].textContent = running ? "正在计算…" : "运行 Compute Probe";
  }

  renderComputeProbe(result) {
    if (!result?.supported) {
      this.refs["compute-probe-result"].textContent = `不支持 · ${result?.reason || "unknown"}`;
      return;
    }
    if (result?.error) {
      this.refs["compute-probe-result"].textContent = `失败 · ${result.error}`;
      return;
    }
    const gpu = Number.isFinite(result.gpuComputeMs) ? ` · GPU ${result.gpuComputeMs.toFixed(3)} ms` : "";
    this.refs["compute-probe-result"].textContent = result.passed
      ? `通过 · ${result.verification.checked}/${result.count} · ${result.bytes} B · workgroup ${result.workgroupSize} · dispatch ${result.dispatchCount}${gpu}`
      : `失败 · mismatches ${result.verification?.mismatches ?? "?"}`;
  }

  setSpatialProbeRunning(running) {
    this.refs["spatial-probe"].disabled = Boolean(running);
    this.refs["spatial-probe"].textContent = running ? "正在筛选…" : "运行 Spatial Probe";
  }

  renderSpatialProbe(result) {
    if (!result?.supported) {
      this.refs["spatial-probe-result"].textContent = `不支持 · ${result?.reason || "unknown"}`;
      return;
    }
    if (result?.error) {
      this.refs["spatial-probe-result"].textContent = `失败 · ${result.error}`;
      return;
    }
    const gpu = Number.isFinite(result.gpuComputeMs) ? ` · GPU ${result.gpuComputeMs.toFixed(3)} ms` : "";
    this.refs["spatial-probe-result"].textContent = result.passed
      ? `通过 · ${result.verification.checked}/${result.count} · 命中 ${result.visible} · CPU ${result.cpuReferenceMs.toFixed(3)} ms · compute ${result.computeSubmitMs.toFixed(3)} ms · readback ${result.readbackMs.toFixed(3)} ms${gpu} · 总计 ${result.elapsedMs.toFixed(2)} ms`
      : `失败 · mismatches ${result.verification?.mismatches ?? "?"}`;
  }




  setCompactionBusy(busy) {
    const button = this.refs["compaction-probe"];
    if (!button) return;
    button.disabled = Boolean(busy);
    if (busy) button.textContent = "正在压缩可见实例…";
  }

  setCompactionResult(result) {
    const button = this.refs["compaction-probe"];
    if (!button) return;
    if (!result) {
      button.disabled = false;
      button.textContent = "显示 GPU Compaction";
      button.title = "GPU distance filter + atomic compaction + indirect draw；不读回 CPU。";
      return;
    }
    if (!result.supported) {
      button.disabled = true;
      button.textContent = "GPU Compaction 需要 WebGPU";
      button.title = result.reason || "webgpu-required";
      return;
    }
    if (result.passed === false) {
      button.disabled = false;
      button.textContent = "GPU Compaction 失败";
      button.title = result.reason || "unknown";
      return;
    }
    button.disabled = false;
    button.textContent = `隐藏 GPU Compaction · ${result.actualVisible}/${result.expectedVisible}`;
    const gpu = Number.isFinite(result.gpuComputeMs) ? `${result.gpuComputeMs.toFixed(3)} ms` : "—";
    button.title = `${result.actualVisible}/${result.expectedVisible} 实际/预期可见 · ${result.passed ? "集合验证通过" : "集合验证失败"} · workgroup ${result.workgroupSize} · compute ${result.computeSubmitMs.toFixed(3)} ms · 验证回读 ${result.validationReadbackMs.toFixed(3)} ms · GPU ${gpu}`;
  }
  setIndirectDrawBusy(busy) {
    const button = this.refs["indirect-draw-probe"];
    if (!button) return;
    button.disabled = Boolean(busy);
    if (busy) button.textContent = "正在构建 Indirect Draw…";
  }

  setIndirectDrawResult(result) {
    const button = this.refs["indirect-draw-probe"];
    if (!button) return;
    if (!result) {
      button.disabled = false;
      button.textContent = "显示 Indirect Draw";
      button.title = "GPU compute 写入 indirect instanceCount；不读回 CPU。";
      return;
    }
    if (!result.supported) {
      button.disabled = true;
      button.textContent = "Indirect Draw 需要 WebGPU";
      button.title = result.reason || "webgpu-required";
      return;
    }
    if (result.passed === false) {
      button.disabled = false;
      button.textContent = "Indirect Draw 失败";
      button.title = result.reason || "unknown";
      return;
    }
    button.disabled = false;
    button.textContent = "隐藏 Indirect Draw";
    const gpu = Number.isFinite(result.gpuComputeMs) ? `${result.gpuComputeMs.toFixed(3)} ms` : "—";
    button.title = `capacity ${result.capacity} · GPU draw instances ${result.visibleCount} · compute ${result.computeSubmitMs.toFixed(3)} ms · GPU ${gpu}`;
  }
  setResidentCullingBusy(busy) {
    const button = this.refs["resident-culling-probe"];
    if (!button) return;
    button.disabled = Boolean(busy);
    if (busy) button.textContent = "正在构建 GPU Culling…";
  }

  setResidentCullingResult(result) {
    const button = this.refs["resident-culling-probe"];
    if (!button) return;
    if (!result) {
      button.disabled = false;
      button.textContent = "显示 GPU Culling";
      button.title = "4096 个实例；visibility mask 保留在 GPU，不回读 CPU。";
      return;
    }
    if (!result.supported) {
      button.disabled = true;
      button.textContent = "GPU Culling 需要 WebGPU";
      button.title = result.reason || "webgpu-required";
      return;
    }
    if (result.passed === false) {
      button.disabled = false;
      button.textContent = "GPU Culling 失败";
      button.title = result.reason || "unknown";
      return;
    }
    button.disabled = false;
    button.textContent = "隐藏 GPU Culling";
    const gpu = Number.isFinite(result.gpuComputeMs) ? `${result.gpuComputeMs.toFixed(3)} ms` : "—";
    button.title = `${result.expectedVisible}/${result.count} 实例应可见 · compute ${result.computeSubmitMs.toFixed(3)} ms · GPU ${gpu}`;
  }

  configureLabs(labs, activeId) {
    this.refs["lab-select"].replaceChildren(...labs.map((lab) => new Option(lab.title, lab.id, false, lab.id === activeId)));
  }

  configureBackends(backends, activeId) {
    this.refs["backend-select"].replaceChildren(...backends.map((backend) => new Option(backend.title, backend.id, false, backend.id === activeId)));
    this.refs["backend-select"].disabled = backends.length <= 1;
    this.refs["backend-select"].closest("label")?.classList.toggle("is-disabled", backends.length <= 1);
  }

  configureDebugLayers(layerIds = [], defaultIds = layerIds) {
    const enabled = new Set(layerIds);
    const defaults = new Set(defaultIds);
    for (const label of this.root.querySelectorAll("[data-debug-layer]")) {
      const active = enabled.has(label.dataset.debugLayer);
      label.hidden = !active;
      const input = label.querySelector("input[type=checkbox]");
      if (input && active) input.checked = defaults.has(label.dataset.debugLayer);
    }
  }

  setLabTitle(title) {
    this.refs["lab-title"].textContent = `${title} · 观测台`;
  }

  setLabIdentity(labId) {
    this.root.dataset.lab = labId || "physics";
  }

  setBusy(busy, message = "正在加载实验…") {
    this.root.setAttribute("aria-busy", String(Boolean(busy)));
    this.refs["status-layer"].hidden = !busy;
    this.refs["status-text"].textContent = message;
    this.refs["status-layer"].querySelector(".obs-spinner").hidden = !busy;
    this.refs["status-action"].hidden = true;
    this.refs["status-action"].onclick = null;
    this.refs.run.disabled = Boolean(busy);
    this.refs.step.disabled = Boolean(busy);
    this.refs.step10.disabled = Boolean(busy);
    this.refs.reset.disabled = Boolean(busy);
  }

  setRendererFailure(message = "渲染设备丢失", recover = () => location.reload()) {
    this.root.setAttribute("aria-busy", "true");
    this.refs["status-layer"].hidden = false;
    this.refs["status-layer"].querySelector(".obs-spinner").hidden = true;
    this.refs["status-text"].textContent = message;
    this.refs["status-action"].hidden = false;
    this.refs["status-action"].onclick = recover;
    this.refs.run.disabled = true;
    this.refs.step.disabled = true;
    this.refs.step10.disabled = true;
    this.refs.reset.disabled = true;
  }

  renderScenarios(scenarios, activeId, onSelect) {
    this.scenarioIndexById = new Map(scenarios.map((scenario, index) => [scenario.id, index + 1]));
    this.refs["scenario-list"].replaceChildren(...scenarios.map((scenario, index) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = `obs-scenario${scenario.id === activeId ? " is-active" : ""}`;
      button.setAttribute("aria-pressed", String(scenario.id === activeId));
      button.title = `${scenario.title} — ${scenario.subtitle || scenario.id}`;
      button.innerHTML = `<i>${String(index + 1).padStart(2, "0")}</i><span>${escapeHtml(scenario.title)}</span><small>${escapeHtml(scenario.subtitle || scenario.id)}</small>`;
      button.addEventListener("click", () => onSelect(scenario.id));
      return button;
    }));
  }

  setRunning(running) {
    this.refs.run.classList.toggle("is-running", running);
    this.refs.run.innerHTML = running
      ? `${icon("pause")}<span>暂停</span><small>空格</small>`
      : `${icon("play")}<span>运行</span><small>空格</small>`;
  }

  update({ scenario, clock, inspector, assertions, metrics, checkpointFrame = null }) {
    this.refs.frame.textContent = String(clock.frame);
    this.refs.time.textContent = `${clock.time.toFixed(3)} s`;
    const hasCheckpoint = Number.isInteger(checkpointFrame) && checkpointFrame >= 0;
    this.refs["checkpoint-frame"].textContent = hasCheckpoint ? String(checkpointFrame) : "—";
    this.refs.restore.disabled = !hasCheckpoint;

    const scenarioIndex = this.scenarioIndexById.get(scenario.id) || 1;
    this.refs["scenario-badge"].innerHTML = `<small>场景 // ${String(scenarioIndex).padStart(3, "0")}</small><b>${escapeHtml(scenario.title)}</b><span>${escapeHtml(scenario.description || scenario.subtitle || "")}</span>`;
    this.refs["scenario-badge"].setAttribute("aria-label", `${scenario.title}：${scenario.description || scenario.subtitle || "查看场景详情"}`);
    this.refs["run-scenario-card"].innerHTML = `<strong>${escapeHtml(scenario.title)}</strong><small>${escapeHtml(scenario.subtitle || scenario.id)}</small>`;

    const normalizedAssertions = assertions || [];
    const failures = normalizedAssertions.filter((item) => assertionStatus(item) === "fail").length;
    const pending = normalizedAssertions.filter((item) => assertionStatus(item) === "pending").length;
    const summary = this.refs["result-summary"];
    summary.className = "obs-result-summary";
    if (failures) {
      summary.textContent = `${failures} 失败`;
      summary.classList.add("is-fail");
    } else if (pending) {
      summary.textContent = `${pending} 等待`;
      summary.classList.add("is-pending");
    } else if (normalizedAssertions.length) {
      summary.textContent = "通过";
      summary.classList.add("is-pass");
    } else {
      summary.textContent = "—";
      summary.classList.add("is-neutral");
    }

    this.refs.inspector.innerHTML = renderInspector(inspector);
    this.refs.assertions.innerHTML = normalizedAssertions.map(renderAssertion).join("") || `<div class="obs-empty">暂无执行节点</div>`;
    this.refs.metrics.innerHTML = Object.entries(metrics || {}).map(([key, value]) => `<div><span>${escapeHtml(displayKey(key))}</span><b>${escapeHtml(formatValue(value))}</b></div>`).join("") || `<div class="obs-empty">暂无测量数据</div>`;

    const activeAction = metrics?.tool || metrics?.action || inspector?.values?.lastAction || inspector?.values?.state || (clock.running ? "simulation running" : "idle");
    this.refs["active-action"].textContent = formatValue(activeAction || "idle");
  }
}

const assertionStatus = (assertion) => assertion.status || (assertion.pass ? "pass" : "fail");

const escapeHtml = (value) => String(value)
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll("\"", "&quot;");

const DISPLAY_KEYS = Object.freeze({
  position: "位置", heldBy: "持有者", humanHeld: "人工持有", lastAction: "上次动作", lastResult: "上次结果",
  interactable: "可交互", inRange: "交互距离内", visible: "可见", blocker: "阻挡物", supportOn: "位于支撑面", eventCount: "事件数",
  backend: "后端", renderer: "Renderer", "render backend": "渲染后端", "render mode": "渲染模式", "render fallback": "渲染回退", "render health": "渲染健康", "gpu timing": "GPU Timing", "gpu render": "GPU 渲染耗时", "timestamp query": "Timestamp Query", "webgpu compatibility": "WebGPU 兼容模式", "webgpu features": "WebGPU Features", "storage buffer": "Storage Buffer 上限", "compute workgroup": "Compute Workgroup", solver: "求解器", bodies: "刚体数", colliders: "碰撞体数", joints: "关节数", contacts: "接触数", entities: "实体数",
  objects: "对象数", overlaps: "重叠数", reachable: "可达", reason: "原因", waypoints: "路径点", cost: "代价", state: "状态",
  held: "持有对象", action: "动作", events: "事件数", definitions: "工具定义数", tool: "工具", outcome: "结果", verified: "已验证", provider: "Provider", jobStatus: "任务状态", artifactIntegrity: "产物完整性", assetId: "资产 ID", assetAdmission: "资产准入", compilerQuality: "编译质量", instanceId: "实例 ID", taskStatus: "智能体任务", planningRounds: "规划轮次", connectorRequests: "Connector 请求",
  elapsed: "耗时", "physics.step": "物理步耗时", "native debug": "原生调试", "manifest colliders": "清单碰撞体数",
  "manifest→physics pos Δ": "清单→物理 位置 Δ", "manifest→physics rot Δ": "清单→物理 旋转 Δ", "manifest→physics shape Δ": "清单→物理 形状 Δ",
  "manifest missing": "清单缺失", "manifest shape mismatch": "清单形状不匹配", "fixed dt": "固定步长", "ray hits": "射线命中数",
  "free space": "自由空间", "nav triangles": "导航网格三角形", "query time": "查询耗时", "support on": "位于支撑面",
  "tool.called": "工具调用数", "task status": "任务状态", "planning steps": "规划步数", "gateway rounds": "网关轮次", "sequence events": "序列事件数"
});

const DISPLAY_VALUES = Object.freeze({
  idle: "空闲", running: "运行中", enabled: "已启用", disabled: "已禁用", available: "可用", unavailable: "不可用",
  dynamic: "动态", kinematic: "运动学", fixed: "固定", held: "持有", empty: "空", completed: "已完成", "no-mutation": "无变更",
  verified: "已验证", pass: "通过", fail: "失败", pending: "等待", reachable: "可达", blocked: "受阻", true: "是", false: "否"
});

const displayKey = (key) => DISPLAY_KEYS[key] || key;

const formatValue = (value) => {
  if (Array.isArray(value)) return value.map((item) => Number.isFinite(item) ? item.toFixed(3) : (DISPLAY_VALUES[String(item)] || item)).join(", ");
  if (typeof value === "number") return Number.isInteger(value) ? String(value) : value.toFixed(4);
  if (typeof value === "boolean") return value ? "是" : "否";
  if (value == null) return "—";
  if (typeof value === "object") return JSON.stringify(value);
  return DISPLAY_VALUES[String(value)] || String(value);
};

const renderInspector = (inspector) => {
  if (!inspector) return `<div class="obs-empty">运行场景后显示关键 Runtime 状态。</div>`;
  const rows = Object.entries(inspector.values || {}).map(([key, value]) => `<div class="obs-kv"><span>${escapeHtml(displayKey(key))}</span><b>${escapeHtml(formatValue(value))}</b></div>`).join("");
  return `<div class="obs-inspector-head"><span>对象 / 系统</span><b>${escapeHtml(inspector.title || "Runtime")}</b><small>${escapeHtml(inspector.kind || "")}</small></div>${rows}`;
};

const renderAssertion = (assertion, index) => {
  const status = assertionStatus(assertion);
  const label = status === "pass" ? "验证" : status === "pending" ? "等待" : "问题";
  const mark = status === "pass" ? "✓" : status === "pending" ? "·" : "!";
  return `<article class="obs-flow-node is-${status}">
    <div class="obs-flow-dot">${mark}</div>
    <div class="obs-flow-content">
      <span class="obs-flow-kicker">${label} // ${String(index + 1).padStart(2, "0")}</span>
      <div class="obs-flow-card"><strong>${escapeHtml(assertion.label)}</strong>${assertion.detail ? `<small>${escapeHtml(assertion.detail)}</small>` : ""}</div>
    </div>
  </article>`;
};

const debugToggle = (layer, id, label) => `<label data-debug-layer="${layer}" class="obs-layer-row"><span>${escapeHtml(label)}</span><input id="obs-${id}" type="checkbox" checked /><i></i></label>`;

const toolArgumentTemplate = (schema = {}) => {
  const properties = schema.properties || {};
  const keys = schema.required?.length ? schema.required : Object.keys(properties).slice(0, 4);
  return Object.fromEntries(keys.map((key) => [key, toolArgumentValue(key, properties[key] || {})]));
};

const toolArgumentValue = (key, schema) => {
  if (schema.default !== undefined) return schema.default;
  if (schema.examples?.length) return schema.examples[0];
  if (schema.enum?.length) return schema.enum[0];
  if (key === "id" || key.endsWith("Id")) return "table";
  if (key === "origin") return [0, 2, 0];
  if (key === "direction") return [0, -1, 0];
  if (key === "position" || key === "point") return [0, 0, 0];
  if (schema.type === "array") return [];
  if (schema.type === "number" || schema.type === "integer") return 0;
  if (schema.type === "boolean") return false;
  if (schema.type === "object") return {};
  return "";
};

const icon = (name) => {
  const paths = {
    focus: '<path d="M7 3H3v4M17 7V3h-4M3 13v4h4M13 17h4v-4M8 10h4"/>',
    terminal: '<path d="M4 5l4 5-4 5M10 15h6"/>',
    "chevron-left": '<path d="M12 5l-5 5 5 5"/>',
    "chevron-right": '<path d="M8 5l5 5-5 5"/>',
    world: '<circle cx="10" cy="10" r="6.5"/><path d="M3.5 10h13M10 3.5c2 2 2 11 0 13M10 3.5c-2 2-2 11 0 13"/>',
    evidence: '<path d="M3 10s2.5-4 7-4 7 4 7 4-2.5 4-7 4-7-4-7-4z"/><circle cx="10" cy="10" r="2"/>',
    cube: '<path d="M10 3l6 3.5v7L10 17l-6-3.5v-7L10 3zM4 6.5l6 3.5 6-3.5M10 10v7"/>',
    flow: '<path d="M6 4h8M6 10h8M6 16h8"/><circle cx="4" cy="4" r="1"/><circle cx="4" cy="10" r="1"/><circle cx="4" cy="16" r="1"/>',
    layers: '<path d="M10 3l7 4-7 4-7-4 7-4zM3 11l7 4 7-4M3 15l7 4 7-4"/>',
    info: '<circle cx="10" cy="10" r="7"/><path d="M10 9v5M10 6.5h.01"/>',
    assignment: '<path d="M6 4h8v12H6zM8 7h4M8 10h4M8 13h3"/>',
    play: '<path d="M7 5l8 5-8 5V5z"/>',
    pause: '<path d="M7 5h2v10H7zM11 5h2v10h-2z"/>',
    step: '<path d="M5 5l6 5-6 5V5zM13 5h2v10h-2z"/>',
    reset: '<path d="M5 6a6 6 0 1 1-1 7M5 6V3M5 6H2"/>',
    more: '<circle cx="5" cy="10" r="1"/><circle cx="10" cy="10" r="1"/><circle cx="15" cy="10" r="1"/>',
    settings: '<circle cx="10" cy="10" r="2.5"/><path d="M10 3.5v2M10 14.5v2M3.5 10h2M14.5 10h2M5.4 5.4l1.4 1.4M13.2 13.2l1.4 1.4M14.6 5.4l-1.4 1.4M6.8 13.2l-1.4 1.4"/>',
    help: '<circle cx="10" cy="10" r="7"/><path d="M8.2 7.8a2 2 0 1 1 3.4 1.4c-.8.7-1.6 1-1.6 2M10 14h.01"/>',
    search: '<circle cx="8.5" cy="8.5" r="4.5"/><path d="M12 12l4 4"/>'
  };
  return `<svg viewBox="0 0 20 20" aria-hidden="true">${paths[name] || ""}</svg>`;
};
