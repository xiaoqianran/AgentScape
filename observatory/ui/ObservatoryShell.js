export class ObservatoryShell {
  constructor(root) {
    this.root = root;
    root.innerHTML = `
      <div class="obs-app">
        <header class="obs-header">
          <div class="obs-brand">
            <strong>AgentScape Observatory</strong>
            <span id="obs-lab-title">运行时观测台</span>
          </div>
          <div class="obs-header-meta">
            <label class="obs-pill">Lab <select id="obs-lab-select"></select></label>
            <label class="obs-pill">Backend <select id="obs-backend-select"></select></label>
            <span class="obs-pill">Clock <b>Fixed 60 Hz</b></span>
            <a class="obs-link" href="/">返回 Studio</a>
          </div>
        </header>
        <div class="obs-toolbar" aria-label="模拟控制">
          <button id="obs-run" class="obs-primary" type="button">▶ 运行</button>
          <button id="obs-step" type="button">|▶ 单步</button>
          <button id="obs-step10" type="button">▶▶ 10 帧</button>
          <button id="obs-reset" type="button">↻ 重置</button>
          <span class="obs-separator"></span>
          <button id="obs-checkpoint" type="button">◉ 记录点</button>
          <button id="obs-restore" type="button" disabled>↶ 重放到记录点</button>
          <span>Checkpoint <b id="obs-checkpoint-frame">—</b></span>
          <span class="obs-separator"></span>
          <span>Frame <b id="obs-frame">0</b></span>
          <span>Time <b id="obs-time">0.000 s</b></span>
        </div>
        <main class="obs-grid">
          <aside class="obs-panel obs-scenarios">
            <div class="obs-panel-title">实验场景</div>
            <div id="obs-scenario-list" class="obs-scenario-list"></div>
            <div class="obs-note"><b>Synthetic Fixtures</b><span>场景直接驱动生产 PhysicsSystem，不实现第二套物理。</span></div>
          </aside>
          <section class="obs-viewport-wrap">
            <div id="obs-viewport" class="obs-viewport" aria-label="三维物理观测视口"></div>
            <div class="obs-viewport-badge" id="obs-scenario-badge"></div>
          </section>
          <aside class="obs-panel obs-inspector">
            <div class="obs-panel-title">Runtime Inspector</div>
            <div id="obs-inspector"></div>
          </aside>
        </main>
        <section class="obs-bottom">
          <div class="obs-debug-controls">
            <strong>Debug Layers</strong>
            <label data-debug-layer="native"><input id="obs-native-debug" type="checkbox" checked /> Native Physics Geometry</label>
            <label data-debug-layer="manifest"><input id="obs-manifest-debug" type="checkbox" checked /> Manifest Collider</label>
            <label data-debug-layer="difference"><input id="obs-difference-debug" type="checkbox" checked /> Truth Difference</label>
            <label data-debug-layer="normalized"><input id="obs-normalized-debug" type="checkbox" checked /> Normalized Collider</label>
            <label data-debug-layer="velocity"><input id="obs-velocity-debug" type="checkbox" checked /> Velocity</label>
            <label data-debug-layer="joint"><input id="obs-joint-debug" type="checkbox" checked /> Joint Frame</label>
            <label data-debug-layer="contact"><input id="obs-contact-debug" type="checkbox" checked /> Contact Normal</label>
            <label data-debug-layer="bounds"><input id="obs-bounds-debug" type="checkbox" checked /> Bounds / Overlap</label>
            <label data-debug-layer="ray"><input id="obs-ray-debug" type="checkbox" checked /> Ray / Hits</label>
            <label data-debug-layer="spatial-query"><input id="obs-spatial-query-debug" type="checkbox" checked /> Spatial Query</label>
            <label data-debug-layer="grid"><input id="obs-grid-debug" type="checkbox" checked /> Grid / Axes</label>
          </div>
          <div class="obs-bottom-grid">
            <div><div class="obs-panel-title">Assertions</div><div id="obs-assertions" class="obs-assertions"></div></div>
            <div><div class="obs-panel-title">Measurements</div><div id="obs-metrics" class="obs-metrics"></div></div>
          </div>
        </section>
      </div>`;
    this.refs = Object.fromEntries([
      "run", "step", "step10", "reset", "checkpoint", "restore", "checkpoint-frame", "frame", "time", "scenario-list", "viewport",
      "scenario-badge", "inspector", "native-debug", "manifest-debug", "difference-debug", "normalized-debug", "velocity-debug", "joint-debug", "contact-debug", "bounds-debug", "ray-debug", "spatial-query-debug", "grid-debug", "assertions", "metrics",
      "lab-title", "lab-select", "backend-select"
    ].map((name) => [name, root.querySelector(`#obs-${name}`)]));
  }

  bind({ onRun, onStep, onStep10, onReset, onCheckpoint, onRestore, onNativeDebug, onManifestDebug, onDifferenceDebug, onNormalizedDebug, onVelocityDebug, onJointDebug, onContactDebug, onBoundsDebug, onRayDebug, onSpatialQueryDebug, onGridDebug, onLabChange, onBackendChange }) {
    this.refs.run.addEventListener("click", onRun);
    this.refs.step.addEventListener("click", onStep);
    this.refs.step10.addEventListener("click", onStep10);
    this.refs.reset.addEventListener("click", onReset);
    this.refs.checkpoint.addEventListener("click", onCheckpoint);
    this.refs.restore.addEventListener("click", onRestore);
    this.refs["native-debug"].addEventListener("change", (event) => onNativeDebug(event.target.checked));
    this.refs["manifest-debug"].addEventListener("change", (event) => onManifestDebug?.(event.target.checked));
    this.refs["difference-debug"].addEventListener("change", (event) => onDifferenceDebug?.(event.target.checked));
    this.refs["normalized-debug"].addEventListener("change", (event) => onNormalizedDebug?.(event.target.checked));
    this.refs["velocity-debug"].addEventListener("change", (event) => onVelocityDebug?.(event.target.checked));
    this.refs["joint-debug"].addEventListener("change", (event) => onJointDebug?.(event.target.checked));
    this.refs["contact-debug"].addEventListener("change", (event) => onContactDebug?.(event.target.checked));
    this.refs["bounds-debug"].addEventListener("change", (event) => onBoundsDebug?.(event.target.checked));
    this.refs["ray-debug"].addEventListener("change", (event) => onRayDebug?.(event.target.checked));
    this.refs["spatial-query-debug"].addEventListener("change", (event) => onSpatialQueryDebug?.(event.target.checked));
    this.refs["grid-debug"].addEventListener("change", (event) => onGridDebug(event.target.checked));
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

  configureDebugLayers(layerIds = []) {
    const enabled = new Set(layerIds);
    for (const label of this.root.querySelectorAll("[data-debug-layer]")) {
      label.hidden = !enabled.has(label.dataset.debugLayer);
    }
  }


  setLabTitle(title) {
    this.refs["lab-title"].textContent = `运行时观测台 · ${title} Lab`;
  }

  renderScenarios(scenarios, activeId, onSelect) {
    this.refs["scenario-list"].replaceChildren(...scenarios.map((scenario) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = `obs-scenario${scenario.id === activeId ? " is-active" : ""}`;
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
    this.refs.inspector.innerHTML = renderInspector(inspector);
    this.refs.assertions.innerHTML = assertions.map(renderAssertion).join("") || `<div class="obs-muted">暂无断言</div>`;
    this.refs.metrics.innerHTML = Object.entries(metrics).map(([key, value]) => `<div><span>${escapeHtml(key)}</span><b>${escapeHtml(String(value))}</b></div>`).join("");
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
  return String(value);
};

const renderInspector = (inspector) => {
  if (!inspector) return `<div class="obs-muted">选择场景后显示 Runtime 状态。</div>`;
  const rows = Object.entries(inspector.values || {}).map(([key, value]) => `<div class="obs-kv"><span>${escapeHtml(key)}</span><b>${escapeHtml(formatValue(value))}</b></div>`).join("");
  return `<div class="obs-inspector-head"><b>${escapeHtml(inspector.title || "Runtime")}</b><span>${escapeHtml(inspector.kind || "")}</span></div>${rows}`;
};

const renderAssertion = (assertion) => {
  const status = assertion.status || (assertion.pass ? "pass" : "fail");
  const icon = status === "pass" ? "✓" : status === "pending" ? "…" : "✕";
  return `<div class="obs-assertion is-${status}"><b>${icon}</b><span>${escapeHtml(assertion.label)}</span>${assertion.detail ? `<small>${escapeHtml(assertion.detail)}</small>` : ""}</div>`;
};
