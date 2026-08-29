import "./style.css";
import { LabRegistry } from "./core/LabRegistry.js";
import { ScenarioRegistry } from "./core/ScenarioRegistry.js";
import { ObservatoryShell } from "./ui/ObservatoryShell.js";

const LABS = [
  {
    id: "physics",
    title: "Physics",
    load: () => import("./labs/physics/index.js")
  },
  {
    id: "spatial",
    title: "Spatial",
    load: () => import("./labs/spatial/index.js")
  },
  {
    id: "navigation",
    title: "Navigation",
    load: () => import("./labs/navigation/index.js")
  },
  {
    id: "interaction",
    title: "Interaction",
    load: () => import("./labs/interaction/index.js")
  },
  {
    id: "agent",
    title: "AgentTools",
    load: () => import("./labs/agent/index.js")
  },
  {
    id: "agent-trace",
    title: "Agent Trace",
    load: () => import("./labs/agent/traceIndex.js")
  }
];

class ObservatoryApp {
  constructor(root) {
    this.labs = new LabRegistry(LABS);
    this.shell = new ObservatoryShell(root);
    this.lab = null;
    this.labDefinition = null;
    this.scenarios = null;
    this.activeLabId = null;
    this.activeBackendId = null;
    this.activeScenarioId = null;
    this.activationVersion = 0;

    this.shell.configureLabs(this.labs.list(), null);
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
    const labId = this.labs.has(requestedLab) ? requestedLab : this.labs.list()[0].id;
    await this.activateLab(labId, {
      backendId: params.get("backend"),
      scenarioId: params.get("scenario")
    });
  }

  async activateLab(labId, { backendId = null, scenarioId = null } = {}) {
    const version = ++this.activationVersion;
    this.shell.setBusy(true, `正在加载 ${labId} Lab…`);
    const module = await this.labs.load(labId);
    if (version !== this.activationVersion) return;
    const definition = module.labDefinition;
    if (!definition || definition.id !== labId || typeof definition.create !== "function") {
      throw new Error(`Invalid Observatory lab module: ${labId}`);
    }

    await this.lab?.dispose?.();
    if (version !== this.activationVersion) return;

    const normalizedBackend = definition.normalizeBackend?.(backendId) || backendId || definition.backends?.[0]?.id || null;
    this.activeLabId = labId;
    this.activeBackendId = normalizedBackend;
    this.labDefinition = definition;
    this.scenarios = new ScenarioRegistry((definition.scenarios || []).map((scenario) => ({ ...scenario, lab: labId })));

    this.shell.configureLabs(this.labs.list(), labId);
    this.shell.configureBackends(definition.backends || [], normalizedBackend);
    this.shell.setLabTitle(definition.title);
    this.shell.setLabIdentity(labId);
    this.shell.configureDebugLayers(definition.debugLayers || ["grid"], definition.defaultDebugLayers || ["grid"]);

    this.lab = definition.create({
      viewport: this.shell.refs.viewport,
      backendId: normalizedBackend,
      onTelemetry: (data) => {
        this.shell.setRunning(data.clock.running);
        this.shell.update(data);
      }
    });
    this.lab.setNativeDebug?.(this.shell.refs["native-debug"].checked);
    this.lab.setManifestDebug?.(this.shell.refs["manifest-debug"].checked);
    this.lab.setDifferenceDebug?.(this.shell.refs["difference-debug"].checked);
    this.lab.setNormalizedDebug?.(this.shell.refs["normalized-debug"].checked);
    this.lab.setVelocityDebug?.(this.shell.refs["velocity-debug"].checked);
    this.lab.setJointDebug?.(this.shell.refs["joint-debug"].checked);
    this.lab.setContactDebug?.(this.shell.refs["contact-debug"].checked);
    this.lab.setBoundsDebug?.(this.shell.refs["bounds-debug"].checked);
    this.lab.setRayDebug?.(this.shell.refs["ray-debug"].checked);
    this.lab.setSpatialQueryDebug?.(this.shell.refs["spatial-query-debug"].checked);
    this.lab.setNavMeshDebug?.(this.shell.refs["navmesh-debug"].checked);
    this.lab.setPathDebug?.(this.shell.refs["path-debug"].checked);
    this.lab.setEndpointsDebug?.(this.shell.refs["endpoints-debug"].checked);
    this.lab.setObstaclesDebug?.(this.shell.refs["obstacles-debug"].checked);
    this.lab.setInteractionLosDebug?.(this.shell.refs["interaction-los-debug"].checked);
    this.lab.setInteractionSupportDebug?.(this.shell.refs["interaction-support-debug"].checked);
    this.lab.setInteractionStateDebug?.(this.shell.refs["interaction-state-debug"].checked);
    this.lab.setAgentToolDebug?.(this.shell.refs["agent-tool-debug"].checked);
    this.lab.setWorldLabelsVisible?.(this.shell.refs["labels-debug"].checked);
    this.lab.setGridVisible?.(this.shell.refs["grid-debug"].checked);

    const available = this.scenarios.list({ lab: labId });
    const initialScenario = available.some((scenario) => scenario.id === scenarioId)
      ? scenarioId
      : available[0]?.id;
    if (!initialScenario) throw new Error(`Lab ${labId} has no scenarios`);
    await this.selectScenario(initialScenario);
  }

  async selectScenario(id) {
    this.activeScenarioId = id;
    const available = this.scenarios.list({ lab: this.activeLabId });
    this.shell.renderScenarios(available, id, (next) => this.selectScenario(next));
    this.updateUrl();
    const scenario = this.scenarios.get(id);
    this.shell.setBusy(true, `正在准备 ${scenario.title}…`);
    try {
      await this.lab.load(scenario);
    } finally {
      this.shell.setBusy(false);
    }
  }

  updateUrl() {
    const url = new URL(location.href);
    url.searchParams.set("lab", this.activeLabId);
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
