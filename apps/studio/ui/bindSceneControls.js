import { bootstrapWorld } from '../../../modules/agent/bootstrapWorld.js';

export function bindSceneControls({ root, world, editor, sceneStore, worldSession = null, tools = null, environmentDefinition = null, getEnvironmentDefinition = null, log, setTaskState }) {
  const disposers=[];
  const listen=(target,type,handler,options)=>{
    target?.addEventListener?.(type,handler,options);
    if (target?.removeEventListener) disposers.push(()=>target.removeEventListener(type,handler,options));
  };
  const currentEnvironmentDefinition=()=>worldSession?.current || getEnvironmentDefinition?.() || environmentDefinition || { id:'environment', bootstrap:{} };
  const undoButton=root.querySelector('#undo');
  const redoButton=root.querySelector('#redo');
  const updateHistoryButtons=(status=world.history.status())=>{
    undoButton.disabled=!status.canUndo;
    redoButton.disabled=!status.canRedo;
  };
  const stopHistory=world.events.on('history.changed',updateHistoryButtons);
  if (typeof stopHistory === 'function') disposers.push(stopHistory);
  updateHistoryButtons();

  root.querySelectorAll('[data-mode]').forEach((button)=>listen(button,'click',()=>{
    editor.setMode(button.dataset.mode);
    root.querySelectorAll('[data-mode]').forEach((candidate)=>candidate.classList.toggle('active',candidate === button));
  }));

  const resetWorldButton=root.querySelector('#reset-world');
  let resetWorldArmed=false;
  let resetWorldTimer=null;
  listen(resetWorldButton,'click',async()=>{
    if (!resetWorldArmed) {
      resetWorldArmed=true;
      resetWorldButton.textContent='确认重置';
      resetWorldTimer=setTimeout(()=>{
        resetWorldArmed=false;
        resetWorldButton.textContent='重置世界';
      },3000);
      return;
    }
    clearTimeout(resetWorldTimer);
    resetWorldTimer=null;
    resetWorldArmed=false;
    resetWorldButton.textContent='正在重置…';
    resetWorldButton.disabled=true;
    try {
      editor.select(null);
      if (worldSession?.reset) await worldSession.reset();
      else {
        sceneStore.clear();
        await world.clearObjects();
        await bootstrapWorld(tools,currentEnvironmentDefinition().bootstrap || {});
        world.history.clear();
      }
      setTaskState('ready','世界已重置','已恢复当前世界初始状态。');
      log(`世界已重置 · ${world.queries.listObjects().length} 个对象`,'result');
    } catch (error) {
      setTaskState('error','重置失败',error.message);
      log(`重置错误：${error.message}`,'error');
    } finally {
      resetWorldButton.disabled=false;
      resetWorldButton.textContent='重置世界';
    }
  });

  listen(root.querySelector('#save-scene'),'click',()=>{
    const scene=world.serialize({ name:'AgentScape World' });
    sceneStore.save(scene);
    log(`场景已保存到本机 · ${scene.objects.length} 个对象`,'result');
  });
  listen(root.querySelector('#load-scene'),'click',async()=>{
    try {
      const scene=sceneStore.load();
      if (!scene) return log('尚无本机场景存档','error');
      editor.select(null);
      if (worldSession?.open) await worldSession.open();
      else await world.restore(scene);
      log(`场景已恢复 · ${scene.objects.length} 个对象`,'result');
    } catch (error) {
      log(`恢复错误：${error.message}`,'error');
    }
  });
  listen(root.querySelector('#export-scene'),'click',()=>{
    const scene=world.serialize({ name:'AgentScape World' });
    downloadJson(`agentscape-${currentEnvironmentDefinition().id}.json`,scene);
    log(`场景已导出 · schema v${scene.schemaVersion}`,'result');
  });

  const importFile=root.querySelector('#import-scene-file');
  listen(root.querySelector('#import-scene'),'click',()=>importFile.click());
  listen(importFile,'change',async()=>{
    const file=importFile.files?.[0];
    if (!file) return;
    try {
      const scene=JSON.parse(await file.text());
      editor.select(null);
      await world.restore(scene);
      sceneStore.save(scene);
      log(`场景已导入 · ${scene.objects.length} 个对象`,'result');
    } catch (error) {
      log(`导入错误：${error.message}`,'error');
    } finally {
      importFile.value='';
    }
  });

  const runHistory=async(direction)=>{
    editor.select(null);
    try {
      await world.history[direction]();
    } catch (error) {
      log(`${direction === 'undo' ? '撤销' : '重做'}失败：${error.message}`,'error');
    }
  };

  listen(undoButton,'click',()=>runHistory('undo'));
  listen(redoButton,'click',()=>runHistory('redo'));
  listen(root.querySelector('#duplicate'),'click',()=>editor.duplicateSelected().catch((error)=>log(`错误：${error.message}`,'error')));
  listen(root.querySelector('#delete'),'click',()=>editor.deleteSelected()?.catch?.((error)=>log(`错误：${error.message}`,'error')));

  listen(window,'keydown',(event)=>{
    if (event.target.matches('input, textarea, select')) return;
    const command=event.ctrlKey || event.metaKey;
    if (command && event.key.toLowerCase() === 'z') {
      event.preventDefault();
      if (event.shiftKey) runHistory('redo'); else runHistory('undo');
      return;
    }
    if (command && event.key.toLowerCase() === 'y') {
      event.preventDefault();
      runHistory('redo');
      return;
    }
    if (event.key.toLowerCase() === 'w') editor.setMode('translate');
    if (event.key.toLowerCase() === 'e') editor.setMode('rotate');
    if (event.key === 'Delete' || event.key === 'Backspace') editor.deleteSelected();
  });

  return {
    dispose() {
      if (resetWorldTimer != null) clearTimeout(resetWorldTimer);
      resetWorldTimer=null;
      while (disposers.length) disposers.pop()?.();
    }
  };
}

function downloadJson(filename,value) {
  const blob=new Blob([JSON.stringify(value,null,2)],{ type:'application/json' });
  const url=URL.createObjectURL(blob);
  const anchor=document.createElement('a');
  anchor.href=url;
  anchor.download=filename;
  anchor.click();
  setTimeout(()=>URL.revokeObjectURL(url),0);
}
