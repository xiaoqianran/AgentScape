export class LabRegistry {
  constructor(definitions = []) {
    this.definitions = new Map();
    definitions.forEach((definition) => this.register(definition));
  }

  register(definition) {
    if (!definition?.id || !definition?.title || typeof definition.load !== "function") {
      throw new TypeError("Lab definition requires id, title, and load()");
    }
    if (this.definitions.has(definition.id)) throw new Error(`Duplicate lab id: ${definition.id}`);
    this.definitions.set(definition.id, Object.freeze({ ...definition }));
    return definition;
  }

  has(id) { return this.definitions.has(id); }
  get(id) {
    const definition = this.definitions.get(id);
    if (!definition) throw new Error(`Unknown lab: ${id}`);
    return definition;
  }
  list() { return [...this.definitions.values()]; }
  async load(id) { return this.get(id).load(); }
}
