export function bindAuthoringWorldControls({
  root,
  controller,
  log = () => {},
  promptImpl = globalThis.prompt?.bind(globalThis),
  confirmImpl = globalThis.confirm?.bind(globalThis)
} = {}) {
  if (!root || !controller) return { refresh:async()=>[], renderStatus:()=>{}, dispose:()=>{} };

  const select = root.querySelector('#authoring-world-select');
  const newButton = root.querySelector('#authoring-new');
  const openButton = root.querySelector('#authoring-open');
  const saveButton = root.querySelector('#authoring-save');
  const saveAsButton = root.querySelector('#authoring-save-as');
  const status = root.querySelector('#authoring-save-status');
  const menuDetails = select?.closest('details') || null;

  let disposed = false;

  const renderStatus = () => {
    if (!status) return;
    const state = controller.status();
    status.textContent = `${state.name}${state.dirty ? ' · 未保存' : ' · 已保存'}`;
  };

  const refresh = async () => {
    const worlds = await controller.list();
    if (!select || disposed) return worlds;

    const selected = controller.status().id;
    select.innerHTML = '<option value="">选择创作世界…</option>';

    for (const world of worlds) {
      const option = document.createElement('option');
      option.value = world.id;
      option.textContent = world.name || world.id;
      option.selected = world.id === selected;
      select.append(option);
    }

    renderStatus();
    return worlds;
  };

  const allowDiscard = () => {
    if (!controller.isDirty()) return true;
    return confirmImpl ? confirmImpl('当前创作世界有未保存更改，确定放弃这些更改吗？') : false;
  };

  newButton?.addEventListener('click', async () => {
    if (!allowDiscard()) return;
    await controller.newWorld();
    await refresh();
    log('已新建空白创作世界', 'result');
  });

  openButton?.addEventListener('click', async () => {
    const id = select?.value;
    if (!id) return log('请选择要打开的创作世界', 'error');
    if (!allowDiscard()) return;

    try {
      await controller.openWorld(id);
      await refresh();
      log(`已打开创作世界：${controller.status().name}`, 'result');
    } catch (error) {
      log(`打开创作世界失败：${error.message}`, 'error');
    }
  });

  saveButton?.addEventListener('click', async () => {
    try {
      const record = await controller.save();
      await refresh();
      log(`创作世界已保存：${record.name}`, 'result');
    } catch (error) {
      log(`保存创作世界失败：${error.message}`, 'error');
    }
  });

  saveAsButton?.addEventListener('click', async () => {
    const current = controller.status();
    const name = promptImpl ? promptImpl('创作世界名称', current.name) : current.name;
    if (name == null) return;

    try {
      const record = await controller.saveAs({ name });
      await refresh();
      log(`创作世界已另存为：${record.name}`, 'result');
    } catch (error) {
      log(`另存创作世界失败：${error.message}`, 'error');
    }
  });

  const beforeUnload = (event) => {
    if (!controller.isDirty()) return;
    event.preventDefault?.();
    event.returnValue = '';
  };

  globalThis.window?.addEventListener?.('beforeunload', beforeUnload);
  menuDetails?.addEventListener?.('toggle', renderStatus);

  refresh().catch((error) => log(`读取创作世界列表失败：${error.message}`, 'error'));

  return {
    refresh,
    renderStatus,
    dispose() {
      disposed = true;
      globalThis.window?.removeEventListener?.('beforeunload', beforeUnload);
      menuDetails?.removeEventListener?.('toggle', renderStatus);
    }
  };
}
