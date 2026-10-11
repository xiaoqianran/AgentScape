import { ToolWorkbenchController } from './workbench/ToolWorkbench.js';
import { renderObservatoryLayout } from './ObservatoryLayout.js';
import { configureInspectorPanel, renderInspectorPanel } from './inspector/InspectorPanel.js';
import { normalizeDiagnostics } from '../core/DiagnosticsContract.js';
import { mountDebugLayerGroups } from './debugging/DebugLayerGroups.js';

export class ObservatoryShell {
  constructor(root) {
    this.root = root;
    this.scenarioIndexById = new Map();
    root.innerHTML = renderObservatoryLayout({icon, debugToggle});

    this.refs = Object.fromEntries([
      "run", "step", "step10", "reset", "checkpoint", "restore", "checkpoint-frame", "frame", "time", "active-action", "scenario-list", "viewport",
      "scenario-badge", "status-layer", "status-text", "status-action", "result-summary", "run-scenario-card", "inspector", "native-debug", "manifest-debug", "difference-debug", "normalized-debug", "velocity-debug", "joint-debug", "contact-debug", "bounds-debug", "ray-debug", "spatial-query-debug", "navmesh-debug", "path-debug", "endpoints-debug", "obstacles-debug", "interaction-los-debug", "interaction-support-debug", "interaction-state-debug", "agent-tool-debug", "labels-debug", "grid-debug", "assertions", "metrics",
      "lab-title", "lab-select", "workspace-select", "backend-select", "focus-view", "scenarios-toggle", "results-toggle", "sidebar-title", "sidebar-subtitle",
      "tools-tab", "resources-tab", "resource-host", "resource-browser-host", "tool-search", "tool-list", "tool-name", "tool-required", "tool-description", "tool-args", "tool-error", "tool-invoke", "tool-outcome", "tool-result", "tool-clear", "tool-history", "resident-culling-probe", "indirect-draw-probe", "compaction-probe", "compute-probe", "compute-probe-result", "spatial-probe", "spatial-probe-result"
    ].map((name) => [name, root.querySelector(`#obs-${name}`)]));

    // Keep every existing layer input / listener intact; regroup only the presentation.
    this.debugLayerGroups = mountDebugLayerGroups(this.root.querySelector('.obs-debug-controls'));
    this.debugLayerDefaults = new Set();
    this.toolWorkbench = new ToolWorkbenchController(this);

    this.onWorkspaceChange = null;
    this.refs["workspace-select"].addEventListener("change", event => this.onWorkspaceChange?.(event.target.value));
    this.root.querySelectorAll('[data-workspace]').forEach(button => button.addEventListener('click', () => {
      this.onWorkspaceChange?.(button.dataset.workspace);
    }));
    this.root.querySelectorAll('[data-layer-preset]').forEach((button) => button.addEventListener('click', () => {
      const mode = button.dataset.layerPreset;
      for (const row of this.root.querySelectorAll('[data-debug-layer]:not([hidden])')) {
        const input = row.querySelector('input');
        const checked = mode === 'all' || (mode === 'defaults' && this.debugLayerDefaults.has(row.dataset.debugLayer));
        if (input && input.checked !== checked) {
          input.checked = checked;
          input.dispatchEvent(new Event('change', { bubbles: true }));
        }
      }
    }));
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
      this.toolWorkbench.toolHistory = [];
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

  configureToolWorkbench(...args) { return this.toolWorkbench.configureToolWorkbench(...args); }
  renderToolList(...args) { return this.toolWorkbench.renderToolList(...args); }
  selectTool(...args) { return this.toolWorkbench.selectTool(...args); }
  invokeSelectedTool(...args) { return this.toolWorkbench.invokeSelectedTool(...args); }
  renderToolHistory(...args) { return this.toolWorkbench.renderToolHistory(...args); }

  setRightTab(tab) {
    const requested = this.root.querySelector(`[data-right-tab="${tab}"]`);
    if (!requested || requested.hidden) return;
    this.root.querySelectorAll("[data-right-tab]").forEach((button) => button.classList.toggle("is-active", button.dataset.rightTab === tab));
    this.root.querySelectorAll("[data-right-panel]").forEach((panel) => panel.classList.toggle("is-active", panel.dataset.rightPanel === tab));
  }

  configureResourceWorkbench(workbench = null) {
    const visible = Boolean(workbench?.mount || workbench?.mountInspector || workbench?.mountBrowser);
    this.refs["resources-tab"].hidden = !visible;
    this.refs["resource-host"].replaceChildren();
    this.refs["resource-browser-host"].replaceChildren();
    this.refs["resource-browser-host"].hidden = !workbench?.mountBrowser;
    this.refs["scenario-list"].hidden = Boolean(workbench?.mountBrowser);
    if (!visible) {
      if (this.root.querySelector('[data-right-tab="resources"]')?.classList.contains("is-active")) this.setRightTab("run");
      return;
    }
    workbench.mountBrowser?.(this.refs["resource-browser-host"]);
    (workbench.mountInspector || workbench.mount)?.(this.refs["resource-host"]);
    this.setPanelVisible("results", true);
    this.setRightTab("resources");
  }

  setResourceMode(active) {
    const enabled = Boolean(active);
    this.root.classList.toggle("obs-resource-mode", enabled);
    this.refs["sidebar-title"].textContent = enabled ? "资源库" : "运行图";
    this.refs["sidebar-subtitle"].textContent = enabled ? "ASSET CATALOG" : "实时执行";
    const worldTab = this.root.querySelector('[data-view="world"] span');
    const evidenceTab = this.root.querySelector('[data-view="evidence"]');
    const fixedPill = this.root.querySelector('.obs-fixed-pill');
    if (worldTab) worldTab.innerHTML = enabled ? "资产预览 <b>PREVIEW</b>" : "真实世界 <b>世界</b>";
    if (evidenceTab) evidenceTab.hidden = enabled;
    if (fixedPill) fixedPill.hidden = enabled;
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

  configureWorkspace(workspace, activeLabId, { legacyTitle = null } = {}) {
    this.root.dataset.workspace = workspace.id;
    this.configureInspectorProfile(activeLabId);
    this.refs["workspace-select"].replaceChildren(...this.workspaces.map(item => new Option(item.title, item.id, false, item.id === workspace.id)));
    this.root.classList.toggle('obs-rendering-workspace', workspace.id === 'rendering');
    this.root.querySelectorAll('[data-workspace]').forEach(button => {
      const active = button.dataset.workspace === workspace.id;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-current', active ? 'page' : 'false');
    });
    const choices = workspace.tools.map(tool => new Option(tool.title, tool.id, false, tool.id === activeLabId));
    if (!workspace.tools.some(tool => tool.id === activeLabId)) {
      choices.push(new Option(activeLabId === "physics" ? "基础物理场景（兼容）" : (legacyTitle || activeLabId), activeLabId, true, true));
    }
    this.refs['lab-select'].replaceChildren(...choices);
    this.refs['lab-select'].disabled = choices.length < 2;
    this.refs['sidebar-title'].textContent = workspace.id === 'assets' ? '资源浏览' : workspace.id === 'rendering' ? '渲染实验场景' : '测试场景';
    this.refs['sidebar-subtitle'].textContent = workspace.id === 'rendering' ? '独立渲染场景 · GPU 诊断' : workspace.title;
    this.root.querySelector('.obs-fixed-pill').hidden = workspace.id === 'rendering' || workspace.id === 'assets';
    if (workspace.id === 'rendering') {
      this.setPanelVisible('results', true);
    }
  }

  configureInspectorProfile(labId) {
    const profile = configureInspectorPanel(this.root, labId);
    // Preserve the current tab on a refresh within one workspace. A workspace
    // transition gets its own default without altering lab-specific panels.
    if (this.inspectorLab !== labId) {
      this.inspectorLab = labId;
      this.setRightTab(profile.defaultTab === 'resources' && this.refs['resources-tab'].hidden ? 'inspect' : profile.defaultTab);
    }
  }

  configureWorkspaces(workspaces) {
    this.workspaces = workspaces;
  }

  configureLabs(labs, activeId) {
    this.knownLabs = labs;
  }

  configureBackends(backends, activeId) {
    this.refs["backend-select"].replaceChildren(...backends.map((backend) => new Option(backend.title, backend.id, false, backend.id === activeId)));
    this.refs["backend-select"].disabled = backends.length <= 1;
    this.refs["backend-select"].closest("label")?.classList.toggle("is-disabled", backends.length <= 1);
  }

  configureDebugLayers(layerIds = [], defaultIds = layerIds) {
    const enabled = new Set(layerIds);
    const defaults = new Set(defaultIds);
    this.debugLayerDefaults = defaults;
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
    const diagnostics = normalizeDiagnostics({inspector, assertions, metrics, capabilities: {
      gpu: this.root.dataset.workspace === 'rendering',
      tools: !this.refs['tools-tab'].hidden,
      resources: !this.refs['resources-tab'].hidden,
      layers: [...this.root.querySelectorAll('[data-debug-layer]:not([hidden])')].map(row => row.dataset.debugLayer)
    }});
    inspector = diagnostics.inspector;
    assertions = diagnostics.assertions;
    metrics = diagnostics.metrics;
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

    this.refs.inspector.innerHTML = renderInspectorPanel(inspector, escapeHtml, displayKey, formatValue);
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
