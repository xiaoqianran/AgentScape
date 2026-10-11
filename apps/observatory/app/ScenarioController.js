export class ScenarioController {
  constructor(app) { this.app = app; }

  selectScenario(id) {
    const app = this.app;
    const version = ++app.scenarioSelectionVersion;
    const activation = app.activationVersion;
    const lab = app.lab;
    const scenario = app.scenarios.get(id);
    if (!scenario) throw new Error(`Unknown scenario: ${id}`);
    app.activeScenarioId = id;
    const available = app.scenarios.list({lab: app.activeLabId});
    app.shell.renderScenarios(available, id, next => app.selectScenario(next));
    app.updateUrl();
    app.shell.setBusy(true, `正在准备 ${scenario.title}…`);
    const isCurrent = () => version === app.scenarioSelectionVersion && activation === app.activationVersion && lab === app.lab;
    const operation = app.scenarioLoadPromise.catch(() => {}).then(async () => {
      if (!isCurrent()) return null;
      try {
        await lab.load(scenario);
        if (!isCurrent()) return null;
        app.shell.configureToolWorkbench(lab.toolDefinitions?.() || [], (name, args) => app.invokeTool(name, args), lab.suggestedToolName?.());
        app.shell.configureResourceWorkbench(lab.resourceWorkbench?.() || null);
        return scenario;
      } finally {
        if (isCurrent()) app.shell.setBusy(false);
      }
    });
    app.scenarioLoadPromise = operation;
    return operation;
  }

  invokeTool(name, args) {
    const app = this.app;
    const lab = app.lab;
    const version = app.scenarioSelectionVersion;
    const activation = app.activationVersion;
    const operation = app.scenarioLoadPromise.catch(() => {}).then(() => {
      if (lab !== app.lab || version !== app.scenarioSelectionVersion || activation !== app.activationVersion) {
        throw Object.assign(new Error('场景已切换，请在新场景中重新调用工具'), {code:'SCENARIO_CHANGED'});
      }
      return lab.invokeTool?.(name, args);
    });
    app.scenarioLoadPromise = operation;
    return operation;
  }
}
