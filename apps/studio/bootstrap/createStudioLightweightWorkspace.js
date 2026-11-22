import { AuthoringWorldStore } from '../persistence/AuthoringWorldStore.js';
import { authoringWorldUrl, builtInWorldUrl } from '../navigation/StudioRoutes.js';

// The worlds index is usable without creating a renderer, physics engine or world session.
// The full Studio remains the only owner of world editing and generation capabilities.
export function createStudioLightweightWorkspace({ ui, environments, location = globalThis.location, store = new AuthoringWorldStore() }) {
  let disposed = false;
  const listeners = new Set();
  let state = Object.freeze({ worlds:[], status:null, loading:true, fileError:'' });
  const notify = (patch) => {
    if (disposed) return;
    state = Object.freeze({ ...state, ...patch });
    for (const listener of listeners) listener();
  };
  const navigate = (url) => { location.assign(url); };
  const currentHref = () => location.href;
  const refresh = async () => {
    notify({ loading:true, fileError:'' });
    try { notify({ worlds:await store.list(), loading:false }); return true; }
    catch (error) { notify({ loading:false, fileError:error.message }); return false; }
  };
  const authoring = {
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    snapshot:() => state,
    refresh,
    async open(id) { navigate(authoringWorldUrl(currentHref(),id)); return null; },
    async createNew() { navigate(authoringWorldUrl(currentHref(),null)); return null; },
    async rename(id,name) {
      const result = await store.rename(id,name);
      await refresh();
      return result;
    },
    async remove(id) {
      const result = await store.remove(id);
      await refresh();
      return result;
    }
  };

  const openBuiltinWorld = async (id) => {
    const definition = environments.find(item => item.id === id);
    const url = new URL(builtInWorldUrl(currentHref(),id));
    if (definition?.rendererMode === 'webgl-legacy') url.searchParams.set('renderer','webgl-legacy');
    navigate(url.href);
  };
  ui.setWorldChangeHandler(openBuiltinWorld);
  ui.attachAuthoring(authoring);
  // Generated artifacts depend on the durable ArtifactModule index. Hydrate the
  // full Studio only when the generated collection is actually requested.
  ui.setWorldCollectionChangeHandler((collection) => {
    if (collection !== 'generated') return;
    const url = new URL(currentHref());
    url.searchParams.set('page','worlds');
    url.searchParams.set('collection','generated');
    url.searchParams.set('fullRuntime','1');
    navigate(url.href);
  });
  ui.attachWorldResources({snapshot:()=>({worlds:[]}),onChange:()=>()=>{}});
  // Keep the existing code-world entry visible. Opening it requests the full
  // runtime; the lightweight index must not instantiate a code editor.
  const emptyCodeSnapshot = Object.freeze({visible:false,active:false,project:null});
  ui.attachCodeProjects({
    subscribe:()=>()=>{},
    snapshot:()=>emptyCodeSnapshot,
    show:()=>{
      const url=new URL(currentHref());
      url.searchParams.set('page','worlds');
      url.searchParams.set('fullRuntime','1');
      url.searchParams.set('openCode','1');
      navigate(url.href);
    }
  });

  // Header and product nav update the URL before this timer fires. Reentering
  // through the full bootstrap preserves existing editor/build/agent behavior.
  const stop = ui.subscribeProductPage((page) => {
    if (page === 'worlds') return;
    setTimeout(()=>{
      if (disposed) return;
      const url = new URL(currentHref());
      url.searchParams.set('page',page);
      navigate(url.href);
    },0);
  });
  // The shell is interactive immediately; IndexedDB metadata loads independently.
  void refresh();
  ui.setRuntimeStatus('ready','工作台就绪');
  return {
    dispose() {
      disposed = true;
      stop();
      listeners.clear();
      ui.setWorldCollectionChangeHandler(null);
      ui.attachAuthoring(null);
      ui.attachWorldResources(null);
      ui.attachCodeProjects(null);
      ui.setWorldChangeHandler(null);
    }
  };
}
