import { CABIN_INLINE_EDITORS, createInlineEditors } from './WorldInteraction.js';

const inlineDescriptors = (definition) => (
  definition?.cabin ? CABIN_INLINE_EDITORS : (definition?.inlineEditors || null)
);

// Studio-only adapter: turns a declarative environment definition into a Runtime Environment
// while keeping DOM editor surfaces owned by the Environment lifetime.
export class StudioEnvironmentMaterializer {
  constructor({ parent, createEditors = createInlineEditors } = {}) {
    if (!parent) throw new TypeError('StudioEnvironmentMaterializer requires a parent surface');
    if (typeof createEditors !== 'function') throw new TypeError('StudioEnvironmentMaterializer requires createEditors');
    this.parent = parent;
    this.createEditors = createEditors;
    this.hosts = new WeakMap();
  }

  async materialize(definition, options = {}) {
    if (!definition?.id || typeof definition?.load !== 'function') {
      throw new TypeError('Studio environment definition requires id and load()');
    }

    const descriptors = inlineDescriptors(definition);
    const host = descriptors?.length ? this.createEditors(this.parent, descriptors) : null;

    try {
      const factory = await definition.load();
      if (typeof factory !== 'function') throw new TypeError(`Environment ${definition.id} load() must resolve to a factory`);
      const environment = await factory({ ...options, editorHost:host });
      if (!environment) throw new TypeError(`Environment ${definition.id} factory returned no Environment`);

      this.hosts.set(environment, host);
      const disposeEnvironment = typeof environment.dispose === 'function'
        ? environment.dispose.bind(environment)
        : null;
      let disposed = false;

      environment.dispose = () => {
        if (disposed) return;
        disposed = true;
        try { disposeEnvironment?.(); }
        finally {
          host?.remove?.();
          this.hosts.delete(environment);
        }
      };

      return environment;
    } catch (error) {
      host?.remove?.();
      throw error;
    }
  }

  hostFor(environment) {
    return environment ? (this.hosts.get(environment) || null) : null;
  }
}
