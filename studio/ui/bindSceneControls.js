import { bootstrapWorld } from '../../agent/bootstrapWorld.js';

export function bindSceneControls({ root, world, editor, sceneStore, tools, environmentDefinition, log, setTaskState }) {
  const undoButton = root.querySelector('#undo');
  const redoButton = root.querySelector('#redo');
  const updateHistoryButtons = (status = world.history.status()) => {
    undoButton.disabled = !status.canUndo;
    redoButton.disabled = !status.canRedo;
  };
  world.events.on('history.changed', updateHistoryButtons);
  updateHistoryButtons();

  root.querySelectorAll('[data-mode]').forEach((button) => button.addEventListener('click', () => {
    editor.setMode(button.dataset.mode);
    root.querySelectorAll('[data-mode]').forEach((candidate) => candidate.classList.toggle('active', candidate === button));
  }));

  const resetWorldButton = root.querySelector('#reset-world');
  let resetWorldArmed = false;
  let resetWorldTimer = null;
  resetWorldButton.addEventListener('click', async () => {
    if (!resetWorldArmed) {
      resetWorldArmed = true;
      resetWorldButton.textContent = '确认重置';
      resetWorldTimer = setTimeout(() => {
        resetWorldArmed = false;
        resetWorldButton.textContent = '重置世界';
      }, 3000);
      return;
    }
    clearTimeout(resetWorldTimer);
    resetWorldArmed = false;
    resetWorldButton.textContent = '正在重置…';
    resetWorldButton.disabled = true;
    try {
      editor.select(null);
      sceneStore.clear();
      await world.clearObjects();
      await bootstrapWorld(tools, environmentDefinition.bootstrap);
      world.history.clear();
      setTaskState('ready', '世界已重置', '已恢复官方初始场景。');
      log(`世界已重置 · ${world.listObjects().length} 个对象`, 'result');
    } catch (error) {
      setTaskState('error', '重置失败', error.message);
      log(`重置错误：${error.message}`, 'error');
    } finally {
      resetWorldButton.disabled = false;
      resetWorldButton.textContent = '重置世界';
    }
  });

  root.querySelector('#save-scene').addEventListener('click', () => {
    const scene = world.serialize({ name: 'AgentScape World' });
    sceneStore.save(scene);
    log(`场景已保存到本机 · ${scene.objects.length} 个对象`, 'result');
  });
  root.querySelector('#load-scene').addEventListener('click', async () => {
    try {
      const scene = sceneStore.load();
      if (!scene) return log('尚无本机场景存档', 'error');
      editor.select(null);
      await world.restore(scene);
      log(`场景已恢复 · ${scene.objects.length} 个对象`, 'result');
    } catch (error) {
      log(`恢复错误：${error.message}`, 'error');
    }
  });
  root.querySelector('#export-scene').addEventListener('click', () => {
    const scene = world.serialize({ name: 'AgentScape World' });
    downloadJson(`agentscape-${environmentDefinition.id}.json`, scene);
    log(`场景已导出 · schema v${scene.schemaVersion}`, 'result');
  });
  const importFile = root.querySelector('#import-scene-file');
  root.querySelector('#import-scene').addEventListener('click', () => importFile.click());
  importFile.addEventListener('change', async () => {
    const file = importFile.files?.[0];
    if (!file) return;
    try {
      const scene = JSON.parse(await file.text());
      editor.select(null);
      await world.restore(scene);
      sceneStore.save(scene);
      log(`场景已导入 · ${scene.objects.length} 个对象`, 'result');
    } catch (error) {
      log(`导入错误：${error.message}`, 'error');
    } finally {
      importFile.value = '';
    }
  });

  undoButton.addEventListener('click', async () => { editor.select(null); await world.history.undo(); });
  redoButton.addEventListener('click', async () => { editor.select(null); await world.history.redo(); });
  root.querySelector('#duplicate').addEventListener('click', () => editor.duplicateSelected().catch((error) => log(`错误：${error.message}`, 'error')));
  root.querySelector('#delete').addEventListener('click', () => editor.deleteSelected()?.catch?.((error) => log(`错误：${error.message}`, 'error')));

  window.addEventListener('keydown', (event) => {
    if (event.target.matches('input, textarea, select')) return;
    const command = event.ctrlKey || event.metaKey;
    if (command && event.key.toLowerCase() === 'z') {
      event.preventDefault();
      editor.select(null);
      if (event.shiftKey) world.history.redo(); else world.history.undo();
      return;
    }
    if (command && event.key.toLowerCase() === 'y') { event.preventDefault(); editor.select(null); world.history.redo(); return; }
    if (event.key.toLowerCase() === 'w') editor.setMode('translate');
    if (event.key.toLowerCase() === 'e') editor.setMode('rotate');
    if (event.key === 'Delete' || event.key === 'Backspace') editor.deleteSelected();
  });
}

function downloadJson(filename, value) {
  const blob = new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
