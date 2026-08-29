export class ObservatoryShell {
  constructor(root) {
    this.root = root;
    this.scenarioIndexById = new Map();
    root.innerHTML = `
      <div class="obs-app">
        <div class="obs-bg" aria-hidden="true"><i></i><i></i></div>

        <header class="obs-topbar">
          <div class="obs-topbar-left">
            <a class="obs-brand" href="/observatory/" aria-label="AgentScape Workbench">
              <span class="obs-brand-dot" aria-hidden="true"></span>
              <div class="obs-brand-copy">
                <strong>AgentScape Workbench</strong>
                <span id="obs-lab-title">Observatory · 运行时验证</span>
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
              <span>Focus</span>
            </button>
            <a class="obs-studio-link" href="/">${icon("terminal")}<span>Studio</span></a>
            <i class="obs-top-separator" aria-hidden="true"></i>
            <button class="obs-top-icon" type="button" data-open-right="layers" title="Debug Layers" aria-label="打开 Debug Layers">${icon("settings")}</button>
            <button class="obs-top-icon" type="button" data-open-right="inspect" title="Runtime Inspect" aria-label="打开运行时检视">${icon("help")}</button>
          </div>
        </header>

        <main class="obs-workspace">
          <aside class="obs-left-sidebar obs-glass" aria-label="实验场景">
            <button id="obs-scenarios-toggle" class="obs-edge-toggle obs-edge-toggle-right" type="button" aria-label="显示或隐藏场景面板" aria-pressed="true">${icon("chevron-left")}</button>
            <div class="obs-sidebar-head">
              <strong>Run Graph</strong>
              <span>LIVE EXECUTION</span>
            </div>
            <div id="obs-scenario-list" class="obs-scenario-list"></div>
          </aside>

          <section class="obs-center-column" aria-label="运行时视口">
            <div class="obs-center-toolbar">
              <div class="obs-view-tabs" role="tablist" aria-label="视图模式">
                <button class="obs-view-tab is-active" type="button" data-view="world">${icon("world")}<span>真实世界 <b>WORLD</b></span></button>
                <button class="obs-view-tab" type="button" data-view="evidence">${icon("evidence")}<span>运行证据 <b>EVIDENCE</b></span></button>
                <button class="obs-view-tab" type="button" data-view="inspect">${icon("cube")}<span>运行时检视 <b>INSPECT</b></span></button>
              </div>
              <div class="obs-fixed-pill"><i></i><span>SIMULATION · 60 HZ FIXED</span></div>
            </div>

            <section class="obs-stage obs-glass" aria-label="运行时 3D 世界">
              <div id="obs-viewport" class="obs-viewport"></div>
              <div class="obs-stage-wash" aria-hidden="true"></div>
              <div class="obs-stage-title" id="obs-scenario-badge"></div>
              <div class="obs-focus-reticle" aria-hidden="true"><i></i><i></i><i></i><i></i></div>
              <div id="obs-status-layer" class="obs-status-layer" hidden>
                <div class="obs-spinner" aria-hidden="true"></div>
                <span id="obs-status-text">正在加载实验…</span>
              </div>
            </section>
          </section>

          <aside class="obs-right-sidebar obs-glass" aria-label="验证与检视">
            <button id="obs-results-toggle" class="obs-edge-toggle obs-edge-toggle-left" type="button" aria-label="显示或隐藏验证面板" aria-pressed="true">${icon("chevron-right")}</button>
            <div class="obs-right-tabs" role="tablist" aria-label="右侧工具">
              <button class="obs-right-tab is-active" type="button" data-right-tab="run">${icon("flow")}<span>执行流</span></button>
              <button class="obs-right-tab" type="button" data-right-tab="layers">${icon("layers")}<span>图层</span></button>
              <button class="obs-right-tab" type="button" data-right-tab="inspect">${icon("info")}<span>检视</span></button>
            </div>

            <div class="obs-right-body">
              <section class="obs-right-panel is-active" data-right-panel="run">
                <div class="obs-run-summary">
                  <div><span>VERIFICATION</span><strong>当前执行流</strong></div>
                  <span id="obs-result-summary" class="obs-result-summary is-neutral">—</span>
                </div>
                <div class="obs-run-graph">
                  <div class="obs-flow-line" aria-hidden="true"></div>
                  <article class="obs-flow-node obs-flow-scenario">
                    <div class="obs-flow-dot">${icon("assignment")}</div>
                    <div class="obs-flow-content">
                      <span class="obs-flow-kicker">SCENARIO</span>
                      <div id="obs-run-scenario-card" class="obs-flow-card"><strong>等待场景</strong><small>选择一个运行时验证任务</small></div>
                    </div>
                  </article>
                  <div id="obs-assertions" class="obs-assertions"></div>
                </div>
              </section>

              <section class="obs-right-panel" data-right-panel="layers">
                <div class="obs-panel-heading"><span>DEBUG VIEW</span><strong>视觉图层</strong><small>只改变观测方式，不改变 Runtime 真值。</small></div>
                <div class="obs-debug-controls">
                  ${debugToggle("native", "native-debug", "Native Physics")}
                  ${debugToggle("manifest", "manifest-debug", "Manifest Collider")}
                  ${debugToggle("difference", "difference-debug", "Truth Difference")}
                  ${debugToggle("normalized", "normalized-debug", "Normalized Collider")}
                  ${debugToggle("velocity", "velocity-debug", "Velocity")}
                  ${debugToggle("joint", "joint-debug", "Joint Frame")}
                  ${debugToggle("contact", "contact-debug", "Contact Normal")}
                  ${debugToggle("bounds", "bounds-debug", "Bounds / Overlap")}
                  ${debugToggle("ray", "ray-debug", "Ray / Hits")}
                  ${debugToggle("spatial-query", "spatial-query-debug", "Spatial Query")}
                  ${debugToggle("navmesh", "navmesh-debug", "NavMesh")}
                  ${debugToggle("path", "path-debug", "Path")}
                  ${debugToggle("endpoints", "endpoints-debug", "Start / End")}
                  ${debugToggle("obstacles", "obstacles-debug", "Dynamic Obstacles")}
                  ${debugToggle("interaction-los", "interaction-los-debug", "LOS / Hit")}
                  ${debugToggle("interaction-support", "interaction-support-debug", "Support Surface")}
                  ${debugToggle("interaction-state", "interaction-state-debug", "Interaction State")}
                  ${debugToggle("agent-tool", "agent-tool-debug", "Tool Result")}
                  ${debugToggle("labels", "labels-debug", "World Labels")}
                  ${debugToggle("grid", "grid-debug", "Grid / Axes")}
                </div>
              </section>

              <section class="obs-right-panel" data-right-panel="inspect">
                <div class="obs-panel-heading"><span>RUNTIME</span><strong>运行时检视</strong><small>关键状态、测量与后端观测值。</small></div>
                <div id="obs-inspector" class="obs-inspector"></div>
                <div class="obs-metrics-title"><span>MEASUREMENTS</span><strong>测量</strong></div>
                <div id="obs-metrics" class="obs-metrics"></div>
              </section>
            </div>
          </aside>
        </main>

        <div class="obs-bottom-dock" aria-label="实验控制">
          <div class="obs-commandbar obs-glass-elevated">
            <button id="obs-run" class="obs-primary" type="button">${icon("play")}<span>运行</span><small>SPACE</small></button>
            <button id="obs-step" type="button">${icon("step")}<span>单步</span></button>
            <button id="obs-step10" type="button"><b>+10</b><span>帧</span></button>
            <i class="obs-dock-divider" aria-hidden="true"></i>
            <button id="obs-reset" class="obs-danger" type="button">${icon("reset")}<span>重置</span></button>
            <details class="obs-more">
              <summary aria-label="更多控制">${icon("more")}</summary>
              <div class="obs-more-menu obs-glass-elevated">
                <button id="obs-checkpoint" type="button">记录 Checkpoint</button>
                <button id="obs-restore" type="button" disabled>重放到 Checkpoint</button>
                <span>记录帧：<b id="obs-checkpoint-frame">—</b></span>
              </div>
            </details>
          </div>
          <div class="obs-sim-strip obs-glass-elevated">
            <span><small>FRM</small><b id="obs-frame">0</b></span>
            <i></i>
            <span><small>SIM</small><b id="obs-time">0.000 s</b></span>
            <i></i>
            <span class="obs-active-op"><em></em><b id="obs-active-action">idle</b></span>
          </div>
        </div>
      </div>`;

    this.refs = Object.fromEntries([
      "run", "step", "step10", "reset", "checkpoint", "restore", "checkpoint-frame", "frame", "time", "active-action", "scenario-list", "viewport",
      "scenario-badge", "status-layer", "status-text", "result-summary", "run-scenario-card", "inspector", "native-debug", "manifest-debug", "difference-debug", "normalized-debug", "velocity-debug", "joint-debug", "contact-debug", "bounds-debug", "ray-debug", "spatial-query-debug", "navmesh-debug", "path-debug", "endpoints-debug", "obstacles-debug", "interaction-los-debug", "interaction-support-debug", "interaction-state-debug", "agent-tool-debug", "labels-debug", "grid-debug", "assertions", "metrics",
      "lab-title", "lab-select", "backend-select", "focus-view", "scenarios-toggle", "results-toggle"
    ].map((name) => [name, root.querySelector(`#obs-${name}`)]));

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
    if (matchMedia("(max-width: 860px)").matches) this.setPanelVisible("results", false);
  }

  setRightTab(tab) {
    this.root.querySelectorAll("[data-right-tab]").forEach((button) => button.classList.toggle("is-active", button.dataset.rightTab === tab));
    this.root.querySelectorAll("[data-right-panel]").forEach((panel) => panel.classList.toggle("is-active", panel.dataset.rightPanel === tab));
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
    if (willShow && matchMedia("(max-width: 860px)").matches) this.setPanelVisible(isScenarios ? "results" : "scenarios", false);
    this.setPanelVisible(panel, willShow);
  }

  bind({ onRun, onStep, onStep10, onReset, onCheckpoint, onRestore, onNativeDebug, onManifestDebug, onDifferenceDebug, onNormalizedDebug, onVelocityDebug, onJointDebug, onContactDebug, onBoundsDebug, onRayDebug, onSpatialQueryDebug, onNavMeshDebug, onPathDebug, onEndpointsDebug, onObstaclesDebug, onInteractionLosDebug, onInteractionSupportDebug, onInteractionStateDebug, onAgentToolDebug, onLabelsDebug, onGridDebug, onFocusView, onLabChange, onBackendChange }) {
    this.refs.run.addEventListener("click", onRun);
    this.refs.step.addEventListener("click", onStep);
    this.refs.step10.addEventListener("click", onStep10);
    this.refs.reset.addEventListener("click", onReset);
    this.refs.checkpoint.addEventListener("click", onCheckpoint);
    this.refs.restore.addEventListener("click", onRestore);
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
    this.refs["lab-select"].addEventListener("change", (event) => onLabChange?.(event.target.value));
    this.refs["backend-select"].addEventListener("change", (event) => onBackendChange?.(event.target.value));
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
    this.refs["lab-title"].textContent = `${title} · Observatory`;
  }

  setLabIdentity(labId) {
    this.root.dataset.lab = labId || "physics";
  }

  setBusy(busy, message = "正在加载实验…") {
    this.root.setAttribute("aria-busy", String(Boolean(busy)));
    this.refs["status-layer"].hidden = !busy;
    this.refs["status-text"].textContent = message;
    this.refs.run.disabled = Boolean(busy);
    this.refs.step.disabled = Boolean(busy);
    this.refs.step10.disabled = Boolean(busy);
    this.refs.reset.disabled = Boolean(busy);
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
      ? `${icon("pause")}<span>暂停</span><small>SPACE</small>`
      : `${icon("play")}<span>运行</span><small>SPACE</small>`;
  }

  update({ scenario, clock, inspector, assertions, metrics, checkpointFrame = null }) {
    this.refs.frame.textContent = String(clock.frame);
    this.refs.time.textContent = `${clock.time.toFixed(3)} s`;
    const hasCheckpoint = Number.isInteger(checkpointFrame) && checkpointFrame >= 0;
    this.refs["checkpoint-frame"].textContent = hasCheckpoint ? String(checkpointFrame) : "—";
    this.refs.restore.disabled = !hasCheckpoint;

    const scenarioIndex = this.scenarioIndexById.get(scenario.id) || 1;
    this.refs["scenario-badge"].innerHTML = `<small>SCENARIO // ${String(scenarioIndex).padStart(3, "0")}</small><b>${escapeHtml(scenario.title)}</b><span>${escapeHtml(scenario.description || scenario.subtitle || "")}</span>`;
    this.refs["run-scenario-card"].innerHTML = `<strong>${escapeHtml(scenario.title)}</strong><small>${escapeHtml(scenario.subtitle || scenario.id)}</small>`;

    const normalizedAssertions = assertions || [];
    const failures = normalizedAssertions.filter((item) => assertionStatus(item) === "fail").length;
    const pending = normalizedAssertions.filter((item) => assertionStatus(item) === "pending").length;
    const summary = this.refs["result-summary"];
    summary.className = "obs-result-summary";
    if (failures) {
      summary.textContent = `${failures} FAIL`;
      summary.classList.add("is-fail");
    } else if (pending) {
      summary.textContent = `${pending} PENDING`;
      summary.classList.add("is-pending");
    } else if (normalizedAssertions.length) {
      summary.textContent = "PASS";
      summary.classList.add("is-pass");
    } else {
      summary.textContent = "—";
      summary.classList.add("is-neutral");
    }

    this.refs.inspector.innerHTML = renderInspector(inspector);
    this.refs.assertions.innerHTML = normalizedAssertions.map(renderAssertion).join("") || `<div class="obs-empty">暂无执行节点</div>`;
    this.refs.metrics.innerHTML = Object.entries(metrics || {}).map(([key, value]) => `<div><span>${escapeHtml(key)}</span><b>${escapeHtml(String(value))}</b></div>`).join("") || `<div class="obs-empty">暂无测量数据</div>`;

    const activeAction = metrics?.tool || metrics?.action || inspector?.values?.lastAction || inspector?.values?.state || (clock.running ? "simulation running" : "idle");
    this.refs["active-action"].textContent = String(activeAction || "idle");
  }
}

const assertionStatus = (assertion) => assertion.status || (assertion.pass ? "pass" : "fail");

const escapeHtml = (value) => String(value)
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll("\"", "&quot;");

const formatValue = (value) => {
  if (Array.isArray(value)) return value.map((item) => Number.isFinite(item) ? item.toFixed(3) : item).join(", ");
  if (typeof value === "number") return Number.isInteger(value) ? String(value) : value.toFixed(4);
  if (value == null) return "—";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
};

const renderInspector = (inspector) => {
  if (!inspector) return `<div class="obs-empty">运行场景后显示关键 Runtime 状态。</div>`;
  const rows = Object.entries(inspector.values || {}).map(([key, value]) => `<div class="obs-kv"><span>${escapeHtml(key)}</span><b>${escapeHtml(formatValue(value))}</b></div>`).join("");
  return `<div class="obs-inspector-head"><span>OBJECT / SYSTEM</span><b>${escapeHtml(inspector.title || "Runtime")}</b><small>${escapeHtml(inspector.kind || "")}</small></div>${rows}`;
};

const renderAssertion = (assertion, index) => {
  const status = assertionStatus(assertion);
  const label = status === "pass" ? "VERIFY" : status === "pending" ? "PENDING" : "ISSUE";
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
    help: '<circle cx="10" cy="10" r="7"/><path d="M8.2 7.8a2 2 0 1 1 3.4 1.4c-.8.7-1.6 1-1.6 2M10 14h.01"/>'
  };
  return `<svg viewBox="0 0 20 20" aria-hidden="true">${paths[name] || ""}</svg>`;
};
