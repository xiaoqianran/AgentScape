export class ObservatoryShell {
  constructor(root) {
    this.root = root;
    root.innerHTML = `
      <div class="obs-app">
        <header class="obs-topbar">
          <div class="obs-brand">
            <span class="obs-brand-mark" aria-hidden="true"><i></i></span>
            <div class="obs-brand-copy"><strong>Observatory</strong><span id="obs-lab-title">运行时验证</span></div>
          </div>
          <nav class="obs-context" aria-label="实验上下文">
            <label><span>Lab</span><select id="obs-lab-select"></select></label>
            <label><span>Backend</span><select id="obs-backend-select"></select></label>
          </nav>
          <div class="obs-panel-actions" aria-label="面板显示">
            <button id="obs-scenarios-toggle" class="obs-icon-button is-active" type="button" aria-label="显示或隐藏场景面板" aria-pressed="true">
              <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4 5h12M4 10h12M4 15h12"/></svg>
            </button>
            <button id="obs-results-toggle" class="obs-icon-button is-active" type="button" aria-label="显示或隐藏验证面板" aria-pressed="true">
              <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M5 4.5h10v11H5zM8 8h4M8 11h4"/></svg>
            </button>
          </div>
          <a class="obs-link" href="/">Studio ↗</a>
        </header>

        <div class="obs-commandbar" aria-label="实验控制">
          <div class="obs-command-primary">
            <span class="obs-command-label">SIMULATION</span>
            <button id="obs-run" class="obs-primary" type="button">▶ 运行</button>
            <button id="obs-step" type="button">单步</button>
            <button id="obs-step10" type="button">10 帧</button>
            <button id="obs-reset" type="button">重置</button>
          </div>
          <div class="obs-clock" aria-label="模拟时钟">
            <span>Frame <b id="obs-frame">0</b></span>
            <span>Time <b id="obs-time">0.000 s</b></span>
          </div>
          <details class="obs-more">
            <summary>更多</summary>
            <div class="obs-more-menu">
              <button id="obs-checkpoint" type="button">记录 Checkpoint</button>
              <button id="obs-restore" type="button" disabled>重放到 Checkpoint</button>
              <span>记录帧：<b id="obs-checkpoint-frame">—</b></span>
              <span>Fixed 60 Hz</span>
            </div>
          </details>
        </div>

        <main class="obs-workspace">
          <aside class="obs-scenario-rail" aria-label="实验场景">
            <div class="obs-section-head">
              <div class="obs-section-kicker">SCENARIOS</div>
              <strong>选择验证任务</strong>
              <span>一次聚焦一个运行时行为</span>
            </div>
            <div id="obs-scenario-list" class="obs-scenario-list"></div>
          </aside>

          <section class="obs-stage" aria-label="运行时视口">
            <div id="obs-viewport" class="obs-viewport"></div>
            <div class="obs-stage-title" id="obs-scenario-badge"></div>
            <div id="obs-status-layer" class="obs-status-layer" hidden>
              <div class="obs-spinner" aria-hidden="true"></div>
              <span id="obs-status-text">正在加载实验…</span>
            </div>
          </section>

          <aside class="obs-results" aria-label="验证结果">
            <section class="obs-result-primary">
              <div class="obs-section-head obs-result-head">
                <div><div class="obs-section-kicker">VERIFICATION</div><strong>验证结果</strong><span>当前场景的首要结论</span></div>
                <span id="obs-result-summary" class="obs-result-summary is-neutral">—</span>
              </div>
              <div id="obs-assertions" class="obs-assertions"></div>
            </section>

            <section class="obs-inspector-section">
              <div class="obs-section-head"><div class="obs-section-kicker">RUNTIME</div><strong>关键状态</strong><span>来自当前系统的观测值</span></div>
              <div id="obs-inspector"></div>
            </section>

            <details class="obs-disclosure">
              <summary>Debug Layers</summary>
              <div class="obs-debug-controls">
                <label data-debug-layer="native"><input id="obs-native-debug" type="checkbox" checked /> Native Physics</label>
                <label data-debug-layer="manifest"><input id="obs-manifest-debug" type="checkbox" checked /> Manifest Collider</label>
                <label data-debug-layer="difference"><input id="obs-difference-debug" type="checkbox" checked /> Truth Difference</label>
                <label data-debug-layer="normalized"><input id="obs-normalized-debug" type="checkbox" checked /> Normalized Collider</label>
                <label data-debug-layer="velocity"><input id="obs-velocity-debug" type="checkbox" checked /> Velocity</label>
                <label data-debug-layer="joint"><input id="obs-joint-debug" type="checkbox" checked /> Joint Frame</label>
                <label data-debug-layer="contact"><input id="obs-contact-debug" type="checkbox" checked /> Contact Normal</label>
                <label data-debug-layer="bounds"><input id="obs-bounds-debug" type="checkbox" checked /> Bounds / Overlap</label>
                <label data-debug-layer="ray"><input id="obs-ray-debug" type="checkbox" checked /> Ray / Hits</label>
                <label data-debug-layer="spatial-query"><input id="obs-spatial-query-debug" type="checkbox" checked /> Spatial Query</label>
                <label data-debug-layer="navmesh"><input id="obs-navmesh-debug" type="checkbox" checked /> NavMesh</label>
                <label data-debug-layer="path"><input id="obs-path-debug" type="checkbox" checked /> Path</label>
                <label data-debug-layer="endpoints"><input id="obs-endpoints-debug" type="checkbox" checked /> Start / End</label>
                <label data-debug-layer="obstacles"><input id="obs-obstacles-debug" type="checkbox" checked /> Dynamic Obstacles</label>
                <label data-debug-layer="interaction-los"><input id="obs-interaction-los-debug" type="checkbox" checked /> LOS / Hit</label>
                <label data-debug-layer="interaction-support"><input id="obs-interaction-support-debug" type="checkbox" checked /> Support Surface</label>
                <label data-debug-layer="interaction-state"><input id="obs-interaction-state-debug" type="checkbox" checked /> Interaction State</label>
                <label data-debug-layer="agent-tool"><input id="obs-agent-tool-debug" type="checkbox" checked /> Tool Result</label>
                <label data-debug-layer="grid"><input id="obs-grid-debug" type="checkbox" checked /> Grid / Axes</label>
              </div>
            </details>

            <details class="obs-disclosure">
              <summary>Measurements</summary>
              <div id="obs-metrics" class="obs-metrics"></div>
            </details>
          </aside>
        </main>
      </div>`;

    this.refs = Object.fromEntries([
      "run", "step", "step10", "reset", "checkpoint", "restore", "checkpoint-frame", "frame", "time", "scenario-list", "viewport",
      "scenario-badge", "status-layer", "status-text", "result-summary", "inspector", "native-debug", "manifest-debug", "difference-debug", "normalized-debug", "velocity-debug", "joint-debug", "contact-debug", "bounds-debug", "ray-debug", "spatial-query-debug", "navmesh-debug", "path-debug", "endpoints-debug", "obstacles-debug", "interaction-los-debug", "interaction-support-debug", "interaction-state-debug", "agent-tool-debug", "grid-debug", "assertions", "metrics",
      "lab-title", "lab-select", "backend-select", "scenarios-toggle", "results-toggle"
    ].map((name) => [name, root.querySelector(`#obs-${name}`)]));

    this.refs["scenarios-toggle"].addEventListener("click", () => this.togglePanel("scenarios"));
    this.refs["results-toggle"].addEventListener("click", () => this.togglePanel("results"));
    if (matchMedia("(max-width: 860px)").matches) this.setPanelVisible("results", false);
  }

  setPanelVisible(panel, visible) {
    const isScenarios = panel === "scenarios";
    const className = isScenarios ? "obs-hide-scenarios" : "obs-hide-results";
    const ref = this.refs[isScenarios ? "scenarios-toggle" : "results-toggle"];
    this.root.classList.toggle(className, !visible);
    ref.classList.toggle("is-active", visible);
    ref.setAttribute("aria-pressed", String(visible));
  }

  togglePanel(panel) {
    const isScenarios = panel === "scenarios";
    const className = isScenarios ? "obs-hide-scenarios" : "obs-hide-results";
    const willShow = this.root.classList.contains(className);
    if (willShow && matchMedia("(max-width: 860px)").matches) {
      this.setPanelVisible(isScenarios ? "results" : "scenarios", false);
    }
    this.setPanelVisible(panel, willShow);
  }

  bind({ onRun, onStep, onStep10, onReset, onCheckpoint, onRestore, onNativeDebug, onManifestDebug, onDifferenceDebug, onNormalizedDebug, onVelocityDebug, onJointDebug, onContactDebug, onBoundsDebug, onRayDebug, onSpatialQueryDebug, onNavMeshDebug, onPathDebug, onEndpointsDebug, onObstaclesDebug, onInteractionLosDebug, onInteractionSupportDebug, onInteractionStateDebug, onAgentToolDebug, onGridDebug, onLabChange, onBackendChange }) {
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
    bindToggle("grid-debug", onGridDebug);
    this.refs["lab-select"].addEventListener("change", (event) => onLabChange?.(event.target.value));
    this.refs["backend-select"].addEventListener("change", (event) => onBackendChange?.(event.target.value));
  }

  configureLabs(labs, activeId) {
    this.refs["lab-select"].replaceChildren(...labs.map((lab) => new Option(lab.title, lab.id, false, lab.id === activeId)));
  }

  configureBackends(backends, activeId) {
    this.refs["backend-select"].replaceChildren(...backends.map((backend) => new Option(backend.title, backend.id, false, backend.id === activeId)));
    this.refs["backend-select"].disabled = backends.length <= 1;
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
    this.refs["lab-title"].textContent = `${title} · 单层验证`;
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
    this.refs["scenario-list"].replaceChildren(...scenarios.map((scenario) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = `obs-scenario${scenario.id === activeId ? " is-active" : ""}`;
      button.setAttribute("aria-pressed", String(scenario.id === activeId));
      button.title = `${scenario.title} — ${scenario.subtitle || scenario.id}`;
      button.innerHTML = `<span>${escapeHtml(scenario.title)}</span><small>${escapeHtml(scenario.subtitle || scenario.id)}</small>`;
      button.addEventListener("click", () => onSelect(scenario.id));
      return button;
    }));
  }

  setRunning(running) {
    this.refs.run.textContent = running ? "⏸ 暂停" : "▶ 运行";
    this.refs.run.classList.toggle("is-running", running);
  }

  update({ scenario, clock, inspector, assertions, metrics, checkpointFrame = null }) {
    this.refs.frame.textContent = String(clock.frame);
    this.refs.time.textContent = `${clock.time.toFixed(3)} s`;
    const hasCheckpoint = Number.isInteger(checkpointFrame) && checkpointFrame >= 0;
    this.refs["checkpoint-frame"].textContent = hasCheckpoint ? String(checkpointFrame) : "—";
    this.refs.restore.disabled = !hasCheckpoint;
    this.refs["scenario-badge"].innerHTML = `<b>${escapeHtml(scenario.title)}</b><span>${escapeHtml(scenario.description || "")}</span>`;

    const normalizedAssertions = assertions || [];
    const failures = normalizedAssertions.filter((item) => (item.status || (item.pass ? "pass" : "fail")) === "fail").length;
    const pending = normalizedAssertions.filter((item) => (item.status || (item.pass ? "pass" : "fail")) === "pending").length;
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
    this.refs.assertions.innerHTML = normalizedAssertions.map(renderAssertion).join("") || `<div class="obs-empty">暂无断言</div>`;
    this.refs.metrics.innerHTML = Object.entries(metrics || {}).map(([key, value]) => `<div><span>${escapeHtml(key)}</span><b>${escapeHtml(String(value))}</b></div>`).join("") || `<div class="obs-empty">暂无测量数据</div>`;
  }
}

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
  return `<div class="obs-inspector-head"><b>${escapeHtml(inspector.title || "Runtime")}</b><span>${escapeHtml(inspector.kind || "")}</span></div>${rows}`;
};

const renderAssertion = (assertion) => {
  const status = assertion.status || (assertion.pass ? "pass" : "fail");
  const icon = status === "pass" ? "✓" : status === "pending" ? "·" : "!";
  return `<div class="obs-assertion is-${status}"><b>${icon}</b><span>${escapeHtml(assertion.label)}</span>${assertion.detail ? `<small>${escapeHtml(assertion.detail)}</small>` : ""}</div>`;
};
