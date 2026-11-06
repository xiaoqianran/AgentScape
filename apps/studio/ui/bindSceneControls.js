import { bootstrapWorld } from '../../../modules/agent/bootstrapWorld.js';
import { createSceneFacade } from '../../../application/scene/SceneFacade.js';
import { exportWorldFile, importWorldFile } from './WorldFileUI.js';

export function bindSceneControls({
  world,
  editor,
  sceneStore,
  worldSession = null,
  tools = null,
  environmentDefinition = null,
  getEnvironmentDefinition = null,
  log = () => {},
  setTaskState = () => {}
}) {
  const assertWorldIdle = () => {
    if (!world.mutationOwner && !world.history?.pending && !world.history?.suspended) return;
    const error = new Error('World mutation already in progress');
    error.code = 'WORLD_MUTATION_BUSY';
    throw error;
  };
  const currentEnvironmentDefinition=()=>worldSession?.current || getEnvironmentDefinition?.() || environmentDefinition || { id:'environment', bootstrap:{} };
  const listeners = new Set();
  const disposers = [];
  let resetWorldArmed=false;
  let resetWorldTimer=null;
  let resetBusy=false;
  let mode='translate';
  let fileStatus='';
  let history=world.history.status();

  const snapshot=()=>Object.freeze({ mode, history, resetWorldArmed, resetBusy, fileStatus });
  let viewSnapshot=snapshot();
  const emit=()=>{
    viewSnapshot=snapshot();
    for(const listener of listeners) listener();
  };
  const subscribe=(listener)=>{
    listeners.add(listener);
    return ()=>listeners.delete(listener);
  };
  const getSnapshot=()=>viewSnapshot;

  const updateHistoryButtons=(status=world.history.status())=>{
    history=status;
    emit();
  };
  const stopHistory=world.events.on('history.changed',updateHistoryButtons);
  if (typeof stopHistory === 'function') disposers.push(stopHistory);

  const setMode=(next)=>{
    if (editor.interactionMode === 'explore') return;
    if (!['translate','rotate'].includes(next)) return;
    mode=next;
    editor.setMode(next);
    emit();
  };

  const resetWorld=async()=>{
    if (!resetWorldArmed) {
      resetWorldArmed=true;
      emit();
      resetWorldTimer=setTimeout(()=>{
        resetWorldArmed=false;
        resetWorldTimer=null;
        emit();
      },3000);
      return { status:'confirm-required' };
    }
    if (resetWorldTimer != null) clearTimeout(resetWorldTimer);
    resetWorldTimer=null;
    resetWorldArmed=false;
    resetBusy=true;
    emit();
    try {
      assertWorldIdle();
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
      return { status:'world-reset' };
    } catch (error) {
      setTaskState('error','重置失败',error.message);
      log(`重置错误：${error.message}`,'error');
      return { status:'error', error };
    } finally {
      resetBusy=false;
      emit();
    }
  };

  const saveScene=()=>{
    const scene=world.serialize({ name:'AgentScape World' });
    sceneStore.save(scene);
    log(`场景已保存到本机 · ${scene.objects.length} 个对象`,'result');
    return scene;
  };

  const loadScene=async()=>{
    try {
      const scene=sceneStore.load();
      if (!scene) {
        log('尚无本机场景存档','error');
        return null;
      }
      assertWorldIdle();
      editor.select(null);
      if (worldSession?.open) await worldSession.open();
      else await world.restore(scene);
      log(`场景已恢复 · ${scene.objects.length} 个对象`,'result');
      return scene;
    } catch (error) {
      log(`恢复错误：${error.message}`,'error');
      return null;
    }
  };

  const exportWorldPackage = async () => {
    try {
      assertWorldIdle();
      const root = await exportWorldFile(world,currentEnvironmentDefinition().id);
      fileStatus='世界包已导出'; emit();
      log('世界包已导出 · '+root.hash.slice(0,12),'result');
      return root;
    } catch(error) {
      if(error.name==='AbortError') {fileStatus='已取消导出';emit();return null;}
      fileStatus='导出失败：'+error.message;emit();
      log('世界包导出错误：'+error.message,'error');
      return null;
    }
  };

  const importWorldPackage = async(file) => {
    if(!file)return null;
    try {
      assertWorldIdle();
      fileStatus='正在验证和导入世界包…';emit();
      const summary=await importWorldFile(world,file);
      editor.select(null);
      // The world archive stays on disk; do not flatten large worlds into localStorage JSON.
      fileStatus='世界包已导入（刷新后可重新导入该文件）';emit();
      log('世界包已导入 · '+summary.entities+' 个对象','result');
      return summary;
    } catch(error) {
      fileStatus='导入失败：'+error.message;emit();
      log('世界包导入错误：'+error.message,'error');
      return null;
    }
  };

  const exportScene=async()=>{
    try {
      const portable = world.environment?.id === 'monument-hall';
      const scene = portable ? (await createSceneFacade(world).save({readResource:(_url,id)=>world.assetModule.readAssetBytes(id)})).value : world.serialize({name:'AgentScape World'});
      downloadJson(`agentscape-${currentEnvironmentDefinition().id}.json`,scene);
      log(portable ? `完整项目已导出 · schema v${scene.schemaVersion}` : '当前环境已导出运行快照（不包含资源包）','result');
      return scene;
    } catch(error) { log(`导出错误：${error.message}`,'error'); return null; }
  };

  const importScene=async(file)=>{
    if (!file) return null;
    try {
      fileStatus='正在预检项目…'; emit();
      if(file.size>96*1024*1024) throw new Error('PROJECT_LIMIT');
      const scene=JSON.parse(await file.text());
      assertWorldIdle();
      editor.select(null);
      if(scene.schema==='agentscape.project-bundle') await createSceneFacade(world).importProject(scene);
      else await world.restore(scene);
      sceneStore.save(world.serialize({name:'AgentScape World'}));
      fileStatus='项目已导入'; emit();
      log(`场景已导入 · ${world.store?.list?.().length ?? scene.objects?.length ?? 0} 个对象`,'result');
      return scene;
    } catch (error) {
      fileStatus='项目导入失败，原项目已保留'; emit();
      log(`导入错误：${error.message}`,'error');
      return null;
    }
  };

  const runHistory=async(direction)=>{
    if (editor.interactionMode === 'explore') return false;
    try {
      assertWorldIdle();
      editor.select(null);
      await world.history[direction]();
      return true;
    } catch (error) {
      log(`${direction === 'undo' ? '撤销' : '重做'}失败：${error.message}`,'error');
      return false;
    }
  };

  const duplicate=()=>editor.duplicateSelected().catch((error)=>log(`错误：${error.message}`,'error'));
  const remove=()=>editor.deleteSelected()?.catch?.((error)=>log(`错误：${error.message}`,'error'));

  const onKeyDown=(event)=>{
    if (editor.interactionMode === 'explore' || event.defaultPrevented || event.target?.isContentEditable) return;
    if (event.target?.matches?.('input, textarea, select')) return;
    const command=event.ctrlKey || event.metaKey;
    if (command && event.key.toLowerCase() === 'z') {
      event.preventDefault();
      void runHistory(event.shiftKey ? 'redo' : 'undo');
      return;
    }
    if (command && event.key.toLowerCase() === 'y') {
      event.preventDefault();
      void runHistory('redo');
      return;
    }
    if (event.key.toLowerCase() === 'w') setMode('translate');
    if (event.key.toLowerCase() === 'e') setMode('rotate');
    if (event.key === 'Delete' || event.key === 'Backspace') remove();
  };
  globalThis.window?.addEventListener?.('keydown',onKeyDown);
  disposers.push(()=>globalThis.window?.removeEventListener?.('keydown',onKeyDown));

  return {
    subscribe,
    snapshot:getSnapshot,
    setMode,
    resetWorld,
    saveScene,
    loadScene,
    exportScene,
    importScene,
    exportWorldPackage,
    importWorldPackage,
    undo:()=>runHistory('undo'),
    redo:()=>runHistory('redo'),
    duplicate,
    deleteSelected:remove,
    dispose() {
      if (resetWorldTimer != null) clearTimeout(resetWorldTimer);
      resetWorldTimer=null;
      listeners.clear();
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
