import { afterEach, describe, expect, it, vi } from 'vitest';
import { bindSceneControls } from '../../apps/studio/ui/bindSceneControls.js';

function element() {
  const listeners = new Map();
  return {
    disabled:false, textContent:'', value:'', files:null,
    classList:{ toggle(){} },
    addEventListener(name, handler) { listeners.set(name, handler); },
    fire(name) { return listeners.get(name)?.({}); },
    click() {}
  };
}

// 历史恢复失败时必须可见：撤销/重做不再静默吞掉异常。
function fixture({ undo = async () => {}, redo = async () => {}, worldSession = null } = {}) {
  const elements = new Map();
  const keydown = [];
  vi.stubGlobal('window', { addEventListener:(name, handler) => { if (name === 'keydown') keydown.push(handler); } });
  const log = vi.fn();
  bindSceneControls({
    root: {
      querySelector:(selector) => { if (!elements.has(selector)) elements.set(selector, element()); return elements.get(selector); },
      querySelectorAll:() => []
    },
    world: {
      events:{ on(){} },
      history:{ status:()=>({canUndo:true,canRedo:true}), undo:vi.fn(undo), redo:vi.fn(redo), clear:vi.fn() },
      clearObjects:async()=>{}, serialize:()=>({schemaVersion:1,objects:[]}), restore:async()=>{},
      queries:{listObjects:()=>[]}
    },
    editor:{ select:vi.fn(), setMode:vi.fn(), duplicateSelected:async()=>{}, deleteSelected:vi.fn() },
    sceneStore:{ save:vi.fn(), load:()=>null, clear:vi.fn() },
    worldSession,
    tools:{}, environmentDefinition:{ id:'monument-hall', bootstrap:{} },
    log, setTaskState:vi.fn()
  });
  return { selector:(name) => elements.get(name), keydown, log };
}

const press = (handler, { key = 'z', shiftKey = false } = {}) => handler({ preventDefault(){}, ctrlKey:true, shiftKey, key, target:{ matches:() => false } });

afterEach(() => vi.unstubAllGlobals());

describe('Studio history controls', () => {
  it('reports a failed undo from the button', async () => {
    const f = fixture({ undo:async () => { throw new Error('restore failed'); } });
    await f.selector('#undo').fire('click');
    expect(f.log).toHaveBeenCalledWith('撤销失败：restore failed', 'error');
  });

  it('reports a failed redo from the keyboard shortcut', async () => {
    const f = fixture({ redo:async () => { throw new Error('restore failed'); } });
    press(f.keydown[0], { key:'z', shiftKey:true });
    await vi.waitFor(() => expect(f.log).toHaveBeenCalledWith('重做失败：restore failed', 'error'));
  });

  it('stays quiet when undo succeeds', async () => {
    const f = fixture();
    await f.selector('#undo').fire('click');
    expect(f.log).not.toHaveBeenCalled();
  });

  it('delegates product reset semantics to WorldSession when available', async () => {
    const reset=vi.fn(async()=>({status:'world-reset'}));
    const f=fixture({worldSession:{reset,current:{id:'generated-world',bootstrap:{}}}});
    await f.selector('#reset-world').fire('click');
    await f.selector('#reset-world').fire('click');
    expect(reset).toHaveBeenCalledOnce();
    expect(f.log).toHaveBeenCalledWith('世界已重置 · 0 个对象','result');
  });
});
