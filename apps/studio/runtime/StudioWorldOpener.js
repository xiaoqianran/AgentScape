export class StudioWorldOpener {
  constructor({
    session,
    builtins = [],
    materializeBuiltin,
    materializeGenerated,
    authoring = null
  } = {}) {
    if (!session?.open) throw new TypeError('StudioWorldOpener requires WorldSession');
    if (typeof materializeBuiltin !== 'function') throw new TypeError('StudioWorldOpener requires materializeBuiltin');
    if (typeof materializeGenerated !== 'function') throw new TypeError('StudioWorldOpener requires materializeGenerated');

    this.session = session;
    this.builtins = new Map(builtins.map((definition) => [definition.id, definition]));
    this.materializeBuiltin = materializeBuiltin;
    this.materializeGenerated = materializeGenerated;
    this.authoring = authoring;
  }

  async open(source = null) {
    if (source == null || source.kind === 'persisted' || source.kind === 'current') {
      return this.session.open(null, { reason:source?.reason || 'studio-persisted-world' });
    }

    if (source.kind === 'builtin') {
      const definition = this.builtins.get(source.id);
      if (!definition) throw new TypeError('Built-in world not found: ' + source.id);
      return this.session.open(
        () => this.materializeBuiltin(definition),
        { reason:source.reason || 'studio-builtin-world' }
      );
    }

    if (source.kind === 'generated') {
      if (!source.artifactId) throw new TypeError('Generated world requires artifactId');
      return this.session.open(
        () => this.materializeGenerated(source.artifactId),
        { reason:source.reason || 'studio-generated-world' }
      );
    }

    // AuthoringDocument is intentionally not a Runtime Environment. It shares the
    // product-level open entry while retaining its frozen Authoring lifecycle boundary.
    if (source.kind === 'authoring') {
      if (!this.authoring?.openWorld) throw new TypeError('World Authoring is unavailable');
      return this.authoring.openWorld(source.id);
    }

    if (source.kind === 'authoring-new') {
      if (!this.authoring?.newWorld) throw new TypeError('World Authoring is unavailable');
      return this.authoring.newWorld(source.options || {});
    }

    throw new TypeError('Unsupported Studio world source: ' + String(source.kind || 'unknown'));
  }
}
