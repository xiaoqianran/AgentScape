export class ScenarioRegistry {
  constructor(scenarios = []) {
    this.scenarios = new Map();
    scenarios.forEach((scenario) => this.register(scenario));
  }

  register(scenario) {
    if (!scenario?.id || !scenario?.title || typeof scenario.setup !== "function") {
      throw new TypeError("Scenario requires id, title, and setup(ctx)");
    }
    if (this.scenarios.has(scenario.id)) throw new Error(`Duplicate scenario id: ${scenario.id}`);
    this.scenarios.set(scenario.id, Object.freeze({ lab: "physics", ...scenario }));
    return scenario;
  }

  get(id) {
    const scenario = this.scenarios.get(id);
    if (!scenario) throw new Error(`Unknown scenario: ${id}`);
    return scenario;
  }

  list({ lab = null } = {}) {
    return [...this.scenarios.values()].filter((scenario) => !lab || scenario.lab === lab);
  }
}
