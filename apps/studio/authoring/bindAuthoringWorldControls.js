export function bindAuthoringWorldControls({
  controller,
  openWorld = (id) => controller.openWorld(id),
  newWorld = (options) => controller.newWorld(options),
  renameWorld = (id, name) => controller.renameWorld(id, name),
  removeWorld = (id) => controller.removeWorld(id),
  onSaved = () => {},
  log = () => {},
  promptImpl = globalThis.prompt?.bind(globalThis),
  confirmImpl = globalThis.confirm?.bind(globalThis)
} = {}) {
  if (!controller) return { subscribe:()=>()=>{}, snapshot:()=>({worlds:[],status:null,loading:false}), dispose:()=>{} };

  const listeners = new Set();
  let worlds = [];
  let status = controller.status();
  let disposed = false;
  let busy = false;
  let loading = true;
  let message = '';
  let fileError = '';
  const promotionState = () => ({ nodes:controller.promotion?.list() || [], busy, message });
  let viewSnapshot = Object.freeze({ worlds, status, loading, fileError, ...promotionState() });

  const emit = () => {
    status = controller.status();
    viewSnapshot = Object.freeze({ worlds, status, loading, fileError, ...promotionState() });
    for (const listener of listeners) listener();
  };
  const subscribe = (listener) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  };
  const snapshot = () => viewSnapshot;

  const refresh = async () => {
    loading = true;
    fileError = '';
    if (!disposed) emit();
    try {
      worlds = await controller.list();
      return worlds;
    } catch (error) {
      fileError=`读取草稿列表失败：${error.message}`;
      log(fileError,'error');
      throw error;
    } finally {
      loading = false;
      if (!disposed) emit();
    }
  };

  const allowDiscard = () => {
    if (!controller.isDirty()) return true;
    return confirmImpl ? confirmImpl('当前创作世界有未保存更改，确定放弃这些更改吗？') : false;
  };

  const createNew = async () => {
    fileError='';emit();
    if (!allowDiscard()) return null;
    try {
      const result = await newWorld();
      await refresh();
      log('已新建空白创作世界','result');
      return result;
    } catch (error) { fileError=`新建草稿失败：${error.message}`;emit();log(fileError,'error');return null; }
  };

  const open = async (id) => {
    fileError='';emit();
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
      fileError=`打开草稿失败：${error.message}`;emit();log(fileError,'error');
      return null;
    }
  };

  const save = async () => {
    fileError='';emit();
    try {
      const record = await controller.save();
      onSaved(record);
      await refresh();
      log(`创作世界已保存：${record.name}`,'result');
      return record;
    } catch (error) {
      fileError=`保存草稿失败：${error.message}`;emit();log(fileError,'error');
      return null;
    }
  };

  const saveAs = async () => {
    fileError='';emit();
    const current = controller.status();
    const name = promptImpl ? promptImpl('创作世界名称',current.name) : current.name;
    if (name == null) return null;
    try {
      const record = await controller.saveAs({ name });
      onSaved(record);
      await refresh();
      log(`创作世界已另存为：${record.name}`,'result');
      return record;
    } catch (error) {
      fileError=`另存草稿失败：${error.message}`;emit();log(fileError,'error');
      return null;
    }
  };

  const rename = async (id, name = null) => {
    fileError='';emit();
    const current = worlds.find((world) => world.id === id);
    const nextName = name == null
      ? (promptImpl ? promptImpl('创作世界名称', current?.name || id) : current?.name || id)
      : name;
    if (nextName == null) return null;
    if (!String(nextName).trim()) {
      fileError='重命名草稿失败：名称不能为空';
      emit();
      return null;
    }
    try {
      const record = await renameWorld(id, nextName);
      await refresh();
      log(`创作世界已重命名：${record.name}`,'result');
      return record;
    } catch (error) {
      fileError=`重命名草稿失败：${error.message}`;emit();log(fileError,'error');
      return null;
    }
  };

  const remove = async (id) => {
    fileError='';emit();
    const current = worlds.find((world) => world.id === id);
    const confirmed = confirmImpl
      ? confirmImpl(`确定删除草稿“${current?.name || id}”吗？删除后无法恢复。`)
      : false;
    if (!confirmed) return null;
    try {
      const result = await removeWorld(id);
      await refresh();
      log(`已删除创作世界：${current?.name || id}`,'result');
      return result;
    } catch (error) {
      fileError=`删除草稿失败：${error.message}`;emit();log(fileError,'error');
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
  const stops = ['authoring.changed', 'authoring.promotion.changed', 'scene.restored', 'history.changed', 'object.removed'].map(event =>
    controller.promotion?.world.events.on(event, () => { if (!disposed) emit(); })).filter(Boolean);
  const stopStatus = controller.onStatusChange?.(() => { if (!disposed) emit(); });

  const promote = async (action, nodeId, options = {}) => {
    if (busy) return null;
    busy = true;
    message = '正在处理创作对象…';
    emit();
    try {
      const result = await controller.tools.call(action, { ...(nodeId ? { nodeId } : {}), ...options });
      message = result.status === 'authoring-restore-failed'
        ? result.results.filter(item => item.status === 'authoring-restore-failed').map(item => item.reason).join('；')
        : ({ 'authoring-prepared':'资产已准备，可检查准入状态后晋升', 'authoring-promoted':'已进入世界，运行检查结果见下方',
          'authoring-provisional':'已进入编辑态，资产仍未通过正式准入', 'authoring-restored':'关联实体已恢复',
          'authoring-verified':'运行行为验证通过；资产准入状态保持独立', 'authoring-unverified':'部分运行检查尚未通过，请查看验证结果',
          'authoring-detached':'关联已解除，正式实体保留，原稿已重新显示' })[result.status] || result.status;
      log(message, result.status?.endsWith('-failed') ? 'error' : 'result');
      return result;
    } catch (error) {
      message = error.message;
      log(message, 'error');
      return null;
    } finally { busy = false; emit(); }
  };

  return {
    subscribe,
    snapshot,
    refresh,
    createNew,
    open,
    save,
    saveAs,
    rename,
    remove,
    promote,
    renderStatus:emit,
    dispose() {
      disposed=true;
      listeners.clear();
      for (const stop of stops) stop();
      stopStatus?.();
      globalThis.window?.removeEventListener?.('beforeunload',beforeUnload);
    }
  };
}
