export function bindAuthoringWorldControls({
  controller,
  openWorld = (id) => controller.openWorld(id),
  newWorld = (options) => controller.newWorld(options),
  log = () => {},
  promptImpl = globalThis.prompt?.bind(globalThis),
  confirmImpl = globalThis.confirm?.bind(globalThis)
} = {}) {
  if (!controller) return { subscribe:()=>()=>{}, snapshot:()=>({worlds:[],status:null}), dispose:()=>{} };

  const listeners = new Set();
  let worlds = [];
  let status = controller.status();
  let disposed = false;
  let viewSnapshot = Object.freeze({ worlds, status });

  const emit = () => {
    status = controller.status();
    viewSnapshot = Object.freeze({ worlds, status });
    for (const listener of listeners) listener();
  };
  const subscribe = (listener) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  };
  const snapshot = () => viewSnapshot;

  const refresh = async () => {
    worlds = await controller.list();
    if (!disposed) emit();
    return worlds;
  };

  const allowDiscard = () => {
    if (!controller.isDirty()) return true;
    return confirmImpl ? confirmImpl('当前创作世界有未保存更改，确定放弃这些更改吗？') : false;
  };

  const createNew = async () => {
    if (!allowDiscard()) return null;
    const result = await newWorld();
    await refresh();
    log('已新建空白创作世界','result');
    return result;
  };

  const open = async (id) => {
    if (!id) {
      log('请选择要打开的创作世界','error');
      return null;
    }
    if (!allowDiscard()) return null;
    try {
      const result = await openWorld(id);
      await refresh();
      log(`已打开创作世界：${controller.status().name}`,'result');
      return result;
    } catch (error) {
      log(`打开创作世界失败：${error.message}`,'error');
      return null;
    }
  };

  const save = async () => {
    try {
      const record = await controller.save();
      await refresh();
      log(`创作世界已保存：${record.name}`,'result');
      return record;
    } catch (error) {
      log(`保存创作世界失败：${error.message}`,'error');
      return null;
    }
  };

  const saveAs = async () => {
    const current = controller.status();
    const name = promptImpl ? promptImpl('创作世界名称',current.name) : current.name;
    if (name == null) return null;
    try {
      const record = await controller.saveAs({ name });
      await refresh();
      log(`创作世界已另存为：${record.name}`,'result');
      return record;
    } catch (error) {
      log(`另存创作世界失败：${error.message}`,'error');
      return null;
    }
  };

  const beforeUnload = (event) => {
    if (!controller.isDirty()) return;
    event.preventDefault?.();
    event.returnValue='';
  };
  globalThis.window?.addEventListener?.('beforeunload',beforeUnload);

  void refresh().catch((error)=>log(`读取创作世界列表失败：${error.message}`,'error'));

  return {
    subscribe,
    snapshot,
    refresh,
    createNew,
    open,
    save,
    saveAs,
    renderStatus:emit,
    dispose() {
      disposed=true;
      listeners.clear();
      globalThis.window?.removeEventListener?.('beforeunload',beforeUnload);
    }
  };
}
