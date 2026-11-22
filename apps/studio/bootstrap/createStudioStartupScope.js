/** Own bootstrap resources from their first successful construction. */
export function createStudioStartupScope({ onDisposeError = (error) => console.error('Studio 清理失败', error) } = {}) {
  const disposables = [];
  let disposed = false;
  return {
    add(resource) {
      if (disposed) throw new Error('STUDIO_STARTUP_SCOPE_DISPOSED');
      if (typeof resource?.dispose === 'function') disposables.push(() => resource.dispose());
      else if (typeof resource === 'function') disposables.push(resource);
      return resource;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const release of disposables.reverse()) {
        try { release(); } catch (error) { onDisposeError(error); }
      }
      disposables.length = 0;
    }
  };
}
