import { createWebGPUCompactionProbe } from './probes/rendering/WebGPUCompactionProbe.js';
import { createWebGPUIndirectDrawProbe } from './probes/rendering/WebGPUIndirectDrawProbe.js';
import { createGPUResidentCullingProbe } from './probes/rendering/WebGPUResidentCullingProbe.js';
import "./style.css";
import { LabRegistry } from "./core/LabRegistry.js";
import { WORKSPACES, resolveWorkspace } from "./core/WorkspaceRegistry.js";
import { ScenarioRegistry } from "./core/ScenarioRegistry.js";
import { ObservatoryShell } from "./ui/ObservatoryShell.js";
import { runWebGPUComputeProbe } from "./probes/rendering/WebGPUComputeProbe.js";
import { runWebGPUSpatialProbe } from "./probes/rendering/WebGPUSpatialProbe.js";
import { createAssetModule } from "../../modules/asset/AssetModule.js";
import { renderingInfoForLab, rendererForLab, projectLabTelemetry } from './app/TelemetryAdapter.js';
import { disposeLabProbes, applyLabDebugLayers } from './app/LabLifecycle.js';


const LABS = [
  {id:"rendering",title:"渲染诊断",load:()=>import("./labs/rendering/index.js")},
  {
    id: "assets",
    title: "资产目录",
    load: () => import("./labs/resources/assets.js")
  },
  {
    id: "gaussian",
    title: "高斯泼溅",
    load: () => import("./labs/resources/gaussian.js")
  },
  {
    id: "physics-studio",
    title: "物理工作台",
    load: () => import("./labs/physics-studio/index.js")
  },
  {
    id: "physics",
    title: "物理（Deprecated）",
    load: () => import("./labs/physics/index.js")
  },
  {
    id: "spatial",
    title: "空间（Deprecated）",
    load: () => import("./labs/spatial/index.js")
  },
  {
    id: "navigation",
    title: "导航（Deprecated）",
    load: () => import("./labs/navigation/index.js")
  },
  {
    id: "interaction",
    title: "交互（Deprecated）",
    load: () => import("./labs/interaction/index.js")
  },
  {
    id: "generation",
    title: "生成与智能体构建（Deprecated）",
    load: () => import("./labs/generation/index.js")
  },
  {
    id: "agent",
    title: "智能体工具（Deprecated）",
    load: () => import("./labs/agent/index.js")
  },
  {
    id: "agent-trace",
    title: "智能体轨迹（Deprecated）",
    load: () => import("./labs/agent/traceIndex.js")
  }
];

class ObservatoryApp {
  constructor(root) {
    this.labs = new LabRegistry(LABS);
    this.assetModule = createAssetModule();
    this.shell = new ObservatoryShell(root);
    this.lab = null;
    this.labDefinition = null;
    this.scenarios = null;
    this.activeLabId = null;
    this.activeWorkspaceId = null;
    this.activeBackendId = null;
    this.activeScenarioId = null;
    this.rendererMode = "auto";
    this.rendererTiming = false;
    this.residentCullingProbe = null;
    this.indirectDrawProbe = null;
    this.compactionProbe = null;
    this.activationVersion = 0;
    this.scenarioSelectionVersion = 0;
    this.scenarioLoadPromise = Promise.resolve();

    this.shell.configureWorkspaces(WORKSPACES);
    this.shell.configureLabs(this.labs.list(), null);
    this.shell.onWorkspaceChange = async (workspaceId) => {
      const workspace = WORKSPACES.find(item => item.id === workspaceId);
      if (!workspace) return;
      this.activeWorkspaceId = workspaceId;
      if (this.activeLabId === workspace.defaultLab) {
        this.shell.configureWorkspace(workspace, this.activeLabId);
        if (workspace.id === "rendering") this.shell.setRightTab("inspect");
        this.updateUrl();
      } else await this.activateLab(workspace.defaultLab);
    };
    this.shell.bind({
      onRun: () => this.lab?.toggleRunning?.(),
      onStep: () => this.lab?.step?.(1),
      onStep10: () => this.lab?.step?.(10),
      onReset: () => this.lab?.reset?.(),
      onCheckpoint: () => this.lab?.captureCheckpoint?.(),
      onRestore: () => this.lab?.restoreCheckpoint?.(),
      onNativeDebug: (visible) => this.lab?.setNativeDebug?.(visible),
      onManifestDebug: (visible) => this.lab?.setManifestDebug?.(visible),
      onDifferenceDebug: (visible) => this.lab?.setDifferenceDebug?.(visible),
      onNormalizedDebug: (visible) => this.lab?.setNormalizedDebug?.(visible),
      onVelocityDebug: (visible) => this.lab?.setVelocityDebug?.(visible),
      onJointDebug: (visible) => this.lab?.setJointDebug?.(visible),
      onContactDebug: (visible) => this.lab?.setContactDebug?.(visible),
      onBoundsDebug: (visible) => this.lab?.setBoundsDebug?.(visible),
      onRayDebug: (visible) => this.lab?.setRayDebug?.(visible),
      onSpatialQueryDebug: (visible) => this.lab?.setSpatialQueryDebug?.(visible),
      onNavMeshDebug: (visible) => this.lab?.setNavMeshDebug?.(visible),
      onPathDebug: (visible) => this.lab?.setPathDebug?.(visible),
      onEndpointsDebug: (visible) => this.lab?.setEndpointsDebug?.(visible),
      onObstaclesDebug: (visible) => this.lab?.setObstaclesDebug?.(visible),
      onInteractionLosDebug: (visible) => this.lab?.setInteractionLosDebug?.(visible),
      onInteractionSupportDebug: (visible) => this.lab?.setInteractionSupportDebug?.(visible),
      onInteractionStateDebug: (visible) => this.lab?.setInteractionStateDebug?.(visible),
      onAgentToolDebug: (visible) => this.lab?.setAgentToolDebug?.(visible),
      onLabelsDebug: (visible) => this.lab?.setWorldLabelsVisible?.(visible),
      onGridDebug: (visible) => this.lab?.setGridVisible?.(visible),
      onFocusView: () => this.lab?.focusScenario?.(),
      onResidentCullingProbe: () => this.toggleResidentCullingProbe(),
      onIndirectDrawProbe: () => this.toggleIndirectDrawProbe(),
      onCompactionProbe: () => this.toggleCompactionProbe(),
      onComputeProbe: () => this.runComputeProbe(),
      onSpatialProbe: () => this.runSpatialProbe(),
      onLabChange: (labId) => this.activateLab(labId),
      onBackendChange: (backendId) => this.activateLab(this.activeLabId, {
        backendId,
        scenarioId: this.activeScenarioId
      })
    });
  }

  async init() {
    const params = new URLSearchParams(location.search);
    const requestedLab = params.get("lab");
    this.rendererMode = params.get("renderer") || "auto";
    this.rendererTiming = params.get("gpuTiming") === "1";
    const labId = this.labs.has(requestedLab) ? requestedLab : "physics-studio";
    this.activeWorkspaceId = resolveWorkspace(params.get("workspace"), labId).id;
    await this.activateLab(labId, {
      backendId: params.get("backend"),
      scenarioId: params.get("scenario")
    });
  }

  async activateLab(labId, { backendId = null, scenarioId = null } = {}) {
    const version = ++this.activationVersion;
    ++this.scenarioSelectionVersion;
    this.shell.setBusy(true, `正在加载 ${labId} Lab…`);
    this.shell.configureToolWorkbench([]);
    this.shell.configureResourceWorkbench(null);
    const module = await this.labs.load(labId);
    if (version !== this.activationVersion) return;
    const definition = module.labDefinition;
    if (!definition || definition.id !== labId || typeof definition.create !== "function") {
      throw new Error(`Invalid Observatory lab module: ${labId}`);
    }

    await this.scenarioLoadPromise.catch(() => {});
    if (version !== this.activationVersion) return;
    disposeLabProbes(this);
    await this.lab?.dispose?.();
    if (version !== this.activationVersion) return;

    const normalizedBackend = definition.normalizeBackend?.(backendId) || backendId || definition.backends?.[0]?.id || null;
    this.activeLabId = labId;
    const workspace = resolveWorkspace(this.activeWorkspaceId, labId);
    this.activeWorkspaceId = workspace.id;
    this.activeBackendId = normalizedBackend;
    this.labDefinition = definition;
    this.scenarios = new ScenarioRegistry((definition.scenarios || []).map((scenario) => ({ ...scenario, lab: labId })));

    this.shell.configureLabs(this.labs.list(), labId);
    this.shell.configureBackends(definition.backends || [], normalizedBackend);
    this.shell.setLabTitle(workspace.id === "rendering" ? "渲染诊断" : (workspace.tools.find((tool) => tool.id === labId)?.title || (labId === "physics" ? "基础物理场景" : definition.title)));
    this.shell.setLabIdentity(labId);
    this.shell.setResourceMode(Boolean(definition.resourceLab));
    this.shell.configureWorkspace(workspace, labId, {legacyTitle:definition.title});
    this.shell.configureDebugLayers(definition.debugLayers || ["grid"], definition.defaultDebugLayers || ["grid"]);

    let nextLab = null;
    nextLab = definition.create({
      viewport: this.shell.refs.viewport,
      assetModule: this.assetModule,
      backendId: normalizedBackend,
      rendererMode: this.rendererMode,
      rendererTiming: this.rendererTiming,
      onRendererFailure: ({ api, reason, message }) => {
        const backend = api || 'GPU';
        this.shell.setRendererFailure(`${backend} 渲染设备丢失 · ${reason || 'unknown'} · ${message || 'unknown'}`);
      },
      onTelemetry: (data) => {
        if (data.scenario?.id !== this.activeScenarioId || labId !== this.activeLabId) return;
        const rendering = renderingInfoForLab(nextLab);
        this.shell.setRunning(data.clock.running);
        this.shell.update(projectLabTelemetry(data, rendering));
      }
    });
    await nextLab.init?.();
    if (version !== this.activationVersion) {
      await nextLab.dispose?.();
      return;
    }
    this.lab = nextLab;
    this.shell.setComputeProbeAvailability(renderingInfoForLab(this.lab)?.backend === "webgpu");
    applyLabDebugLayers(this.lab, this.shell.refs);

    const available = this.scenarios.list({ lab: labId });
    const initialScenario = available.some((scenario) => scenario.id === scenarioId)
      ? scenarioId
      : available[0]?.id;
    if (!initialScenario) throw new Error(`Lab ${labId} has no scenarios`);
    await this.selectScenario(initialScenario);
    if (this.activeWorkspaceId === "rendering") {
      this.shell.setPanelVisible("results", true);
      this.shell.setRightTab("inspect");
    } else if (this.lab.toolDefinitions?.().length) {
      this.shell.setRightTab("tools");
      if (!matchMedia("(max-width: 1040px)").matches) this.shell.setPanelVisible("results", true);
    }
  }

  async runComputeProbe() {
    const renderer = rendererForLab(this.lab);
    this.shell.setComputeProbeRunning(true);
    try {
      const result = await runWebGPUComputeProbe(renderer);
      this.shell.renderComputeProbe(result);
      return result;
    } catch (error) {
      this.shell.renderComputeProbe({ supported: true, passed: false, error: error?.message || String(error) });
      return null;
    } finally {
      this.shell.setComputeProbeRunning(false);
    }
  }

  async runSpatialProbe() {
    const renderer = rendererForLab(this.lab);
    this.shell.setSpatialProbeRunning(true);
    try {
      const result = await runWebGPUSpatialProbe(renderer);
      this.shell.renderSpatialProbe(result);
      return result;
    } catch (error) {
      this.shell.renderSpatialProbe({ supported: true, passed: false, error: error?.message || String(error) });
      return null;
    } finally {
      this.shell.setSpatialProbeRunning(false);
    }
  }




  async toggleCompactionProbe() {
    if (this.compactionProbe) {
      const current = this.compactionProbe;
      this.compactionProbe = null;
      current.scene?.remove(current.result.mesh);
      current.result.dispose?.();
      this.shell.setCompactionResult(null);
      return;
    }
    const renderer = this.lab?.renderer || this.lab?.left?.renderer || null;
    const scene = this.lab?.scene || this.lab?.left?.scene || null;
    if (!renderer || !scene) {
      this.shell.setCompactionResult({ supported:false, reason:'renderer-or-scene-unavailable' });
      return;
    }
    this.shell.setCompactionBusy(true);
    try {
      const result = await createWebGPUCompactionProbe(renderer, { count:4096, radius:18 });
      if (!result.supported) {
        this.shell.setCompactionResult(result);
        return;
      }
      scene.add(result.mesh);
      this.compactionProbe = { result, scene };
      this.shell.setCompactionResult(result);
    } catch (error) {
      this.shell.setCompactionResult({ supported:true, passed:false, reason:error?.message || String(error) });
    } finally {
      this.shell.setCompactionBusy(false);
    }
  }

  async toggleIndirectDrawProbe() {
    if (this.indirectDrawProbe) {
      const current = this.indirectDrawProbe;
      this.indirectDrawProbe = null;
      current.scene?.remove(current.result.mesh);
      current.result.dispose?.();
      this.shell.setIndirectDrawResult(null);
      return;
    }
    const renderer = this.lab?.renderer || this.lab?.left?.renderer || null;
    const scene = this.lab?.scene || this.lab?.left?.scene || null;
    if (!renderer || !scene) {
      this.shell.setIndirectDrawResult({ supported:false, reason:'renderer-or-scene-unavailable' });
      return;
    }
    this.shell.setIndirectDrawBusy(true);
    try {
      const result = await createWebGPUIndirectDrawProbe(renderer, { capacity:4096, visibleCount:256 });
      if (!result.supported) {
        this.shell.setIndirectDrawResult(result);
        return;
      }
      result.mesh.position.set(0, 0, 0);
      scene.add(result.mesh);
      this.indirectDrawProbe = { result, scene };
      this.shell.setIndirectDrawResult(result);
    } catch (error) {
      this.shell.setIndirectDrawResult({ supported:true, passed:false, reason:error?.message || String(error) });
    } finally {
      this.shell.setIndirectDrawBusy(false);
    }
  }

  async toggleResidentCullingProbe() {
    if (this.residentCullingProbe) {
      const current = this.residentCullingProbe;
      this.residentCullingProbe = null;
      current.scene?.remove(current.result.mesh);
      current.result.dispose?.();
      this.shell.setResidentCullingResult(null);
      return;
    }
    const renderer = this.lab?.renderer || this.lab?.left?.renderer || null;
    const scene = this.lab?.scene || this.lab?.left?.scene || null;
    if (!renderer || !scene) {
      this.shell.setResidentCullingResult({ supported: false, reason: 'renderer-or-scene-unavailable' });
      return;
    }
    this.shell.setResidentCullingBusy(true);
    try {
      const result = await createGPUResidentCullingProbe(renderer, { count: 4096, radius: 18 });
      if (!result.supported) {
        this.shell.setResidentCullingResult(result);
        return;
      }
      scene.add(result.mesh);
      this.residentCullingProbe = { result, scene };
      this.shell.setResidentCullingResult(result);
    } catch (error) {
      this.shell.setResidentCullingResult({ supported: true, passed: false, reason: error?.message || String(error) });
    } finally {
      this.shell.setResidentCullingBusy(false);
    }
  }

  selectScenario(id) {
    const version = ++this.scenarioSelectionVersion;
    const lab = this.lab;
    this.activeScenarioId = id;
    const available = this.scenarios.list({ lab: this.activeLabId });
    this.shell.renderScenarios(available, id, (next) => this.selectScenario(next));
    this.updateUrl();
    const scenario = this.scenarios.get(id);
    this.shell.setBusy(true, `正在准备 ${scenario.title}…`);
    const operation = this.scenarioLoadPromise.catch(() => {}).then(async () => {
      if (version !== this.scenarioSelectionVersion || lab !== this.lab) return null;
      try {
        await lab.load(scenario);
        if (version !== this.scenarioSelectionVersion || lab !== this.lab) return null;
        this.shell.configureToolWorkbench(
          lab.toolDefinitions?.() || [],
          (name, args) => this.invokeTool(name, args),
          lab.suggestedToolName?.()
        );
        this.shell.configureResourceWorkbench(lab.resourceWorkbench?.() || null);
        return scenario;
      } finally {
        if (version === this.scenarioSelectionVersion && lab === this.lab) this.shell.setBusy(false);
      }
    });
    this.scenarioLoadPromise = operation;
    return operation;
  }

  invokeTool(name, args) {
    const lab = this.lab;
    const scenarioVersion = this.scenarioSelectionVersion;
    const operation = this.scenarioLoadPromise.catch(() => {}).then(() => {
      if (lab !== this.lab || scenarioVersion !== this.scenarioSelectionVersion) {
        throw Object.assign(new Error("场景已切换，请在新场景中重新调用工具"), { code: "SCENARIO_CHANGED" });
      }
      return lab.invokeTool?.(name, args);
    });
    this.scenarioLoadPromise = operation;
    return operation;
  }

  updateUrl() {
    const url = new URL(location.href);
    url.searchParams.set("lab", this.activeLabId);
    url.searchParams.set("workspace", this.activeWorkspaceId);
    if (this.activeBackendId) url.searchParams.set("backend", this.activeBackendId);
    else url.searchParams.delete("backend");
    if (this.activeScenarioId) url.searchParams.set("scenario", this.activeScenarioId);
    history.replaceState(null, "", url);
  }
}

const root = document.querySelector("#observatory");
const app = new ObservatoryApp(root);
app.init().catch((error) => {
  console.error(error);
  root.textContent = `Observatory 启动失败\n\n${String(error?.stack || error)}`;
  root.className = "obs-fatal";
});
