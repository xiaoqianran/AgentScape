export class StudioWorldOpener {
  constructor({
    session,
    builtins = [],
    materializeBuiltin,
    materializeGenerated,
    authoring = null,
    confirmDiscard = globalThis.confirm?.bind(globalThis)
  } = {}) {
    if (!session?.open) throw new TypeError('StudioWorldOpener requires WorldSession');
    if (typeof materializeBuiltin !== 'function') throw new TypeError('StudioWorldOpener requires materializeBuiltin');
    if (typeof materializeGenerated !== 'function') throw new TypeError('StudioWorldOpener requires materializeGenerated');

    this.session = session;
    this.builtins = new Map(builtins.map((definition) => [definition.id, definition]));
    this.materializeBuiltin = materializeBuiltin;
    this.materializeGenerated = materializeGenerated;
    this.authoring = authoring;
    this.confirmDiscard = confirmDiscard;
  }

  async allowLeaveAuthoring() {
    const status = this.authoring?.status?.();
    if (status?.active !== true || !this.authoring?.isDirty?.()) return true;
    if (typeof this.confirmDiscard !== 'function' || !this.confirmDiscard(`当前创作世界“${status.name || status.id || '未命名草稿'}”有未保存更改，继续切换将放弃这些更改。`)) return false;
    await this.authoring.discardChanges?.();
    return true;
  }

  async open(source = null) {
    if (source == null || source.kind === 'persisted' || source.kind === 'current') {
      if (!(await this.allowLeaveAuthoring())) throw new Error('已取消切换，当前创作草稿仍有未保存更改');
      this.authoring?.restoreOverlayPresentation?.();
      return this.session.open(null, { reason:source?.reason || 'studio-persisted-world' });
    }

    if (source.kind === 'builtin') {
      if (!(await this.allowLeaveAuthoring())) throw new Error('已取消切换，当前创作草稿仍有未保存更改');
      const definition = this.builtins.get(source.id);
      if (!definition) throw new TypeError('Built-in world not found: ' + source.id);
      this.authoring?.restoreOverlayPresentation?.();
      return this.session.open(
        () => this.materializeBuiltin(definition),
        { reason:source.reason || 'studio-builtin-world' }
      );
    }

    if (source.kind === 'generated') {
      if (!(await this.allowLeaveAuthoring())) throw new Error('已取消切换，当前创作草稿仍有未保存更改');
      if (!source.artifactId) throw new TypeError('Generated world requires artifactId');
      this.authoring?.restoreOverlayPresentation?.();
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
