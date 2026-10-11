import { resolveWorkspace } from '../core/WorkspaceRegistry.js';
import { ScenarioRegistry } from '../core/ScenarioRegistry.js';
import { disposeLabProbes, applyLabDebugLayers, initializeLabCandidate } from './LabLifecycle.js';
import { renderingInfoForLab, projectLabTelemetry } from './TelemetryAdapter.js';

export class LabActivationController {
  constructor(app) { this.app = app; }
  async activateLab(labId, { backendId = null, scenarioId = null } = {}) {
    const app = this.app;
    const version = ++app.activationVersion;
    ++app.scenarioSelectionVersion;
    app.shell.setBusy(true, `正在加载 ${labId} Lab…`);
    app.shell.configureToolWorkbench([]);
    app.shell.configureResourceWorkbench(null);
    const module = await app.labs.load(labId);
    if (version !== app.activationVersion) return;
    const definition = module.labDefinition;
    if (!definition || definition.id !== labId || typeof definition.create !== "function") {
      throw new Error(`Invalid Observatory lab module: ${labId}`);
    }

    await app.scenarioLoadPromise.catch(() => {});
    if (version !== app.activationVersion) return;
    disposeLabProbes(app);
    await app.lab?.dispose?.();
    if (version !== app.activationVersion) return;

    const normalizedBackend = definition.normalizeBackend?.(backendId) || backendId || definition.backends?.[0]?.id || null;
    app.activeLabId = labId;
    const workspace = resolveWorkspace(app.activeWorkspaceId, labId);
    app.activeWorkspaceId = workspace.id;
    app.activeBackendId = normalizedBackend;
    app.labDefinition = definition;
    app.scenarios = new ScenarioRegistry((definition.scenarios || []).map((scenario) => ({ ...scenario, lab: labId })));

    app.shell.configureLabs(app.labs.list(), labId);
    app.shell.configureBackends(definition.backends || [], normalizedBackend);
    app.shell.setLabTitle(workspace.id === "rendering" ? "渲染诊断" : (workspace.tools.find((tool) => tool.id === labId)?.title || (labId === "physics" ? "基础物理场景" : definition.title)));
    app.shell.setLabIdentity(labId);
    app.shell.setResourceMode(Boolean(definition.resourceLab));
    app.shell.configureWorkspace(workspace, labId, {legacyTitle:definition.title});
    app.shell.configureDebugLayers(definition.debugLayers || ["grid"], definition.defaultDebugLayers || ["grid"]);

    let nextLab = null;
    nextLab = definition.create({
      viewport: app.shell.refs.viewport,
      assetModule: app.assetModule,
      backendId: normalizedBackend,
      rendererMode: app.rendererMode,
      rendererTiming: app.rendererTiming,
      onRendererFailure: ({ api, reason, message }) => {
        const backend = api || 'GPU';
        app.shell.setRendererFailure(`${backend} 渲染设备丢失 · ${reason || 'unknown'} · ${message || 'unknown'}`);
      },
      onTelemetry: (data) => {
        if (data.scenario?.id !== app.activeScenarioId || labId !== app.activeLabId) return;
        const rendering = renderingInfoForLab(nextLab);
        app.shell.setRunning(data.clock.running);
        app.shell.update(projectLabTelemetry(data, rendering));
      }
    });
    if (!await initializeLabCandidate(nextLab, () => version === app.activationVersion)) return;
    app.lab = nextLab;
    app.shell.setComputeProbeAvailability(renderingInfoForLab(app.lab)?.backend === "webgpu");
    applyLabDebugLayers(app.lab, app.shell.refs);

    const available = app.scenarios.list({ lab: labId });
    const initialScenario = available.some((scenario) => scenario.id === scenarioId)
      ? scenarioId
      : available[0]?.id;
    if (!initialScenario) throw new Error(`Lab ${labId} has no scenarios`);
    await app.selectScenario(initialScenario);
    if (version !== app.activationVersion) return;
    if (app.activeWorkspaceId === "rendering") {
      app.shell.setPanelVisible("results", true);
      app.shell.setRightTab("inspect");
    } else if (app.lab.toolDefinitions?.().length) {
      app.shell.setRightTab("tools");
      if (!matchMedia("(max-width: 1040px)").matches) app.shell.setPanelVisible("results", true);
    }
  }
}
