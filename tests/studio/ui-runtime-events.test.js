import { describe, expect, it, vi } from 'vitest';
import { bindRuntimeEvents } from '../../studio/ui/bindRuntimeEvents.js';

function fixture({ selectedId = 'cup_01', existing = ['cup_01'] } = {}) {
  const handlers = new Map();
  const world = {
    events: { on: (name, handler) => handlers.set(name, handler) },
    store: { has: (id) => existing.includes(id) }
  };
  const editor = { selectedId, select: vi.fn((id) => { editor.selectedId = id; }) };
  const inspector = { render: vi.fn() };
  const taskPanel = { log: vi.fn() };
  const ui = { setView: vi.fn(), setRuntimeStatus: vi.fn(), setRuntimeRecoveryAction: vi.fn() };
  const autosave = { flush: vi.fn(() => ({ objects: [] })) };
  const reload = vi.fn();
  bindRuntimeEvents({ world, editor, inspector, taskPanel, ui, autosave, reload });
  return { handlers, world, editor, inspector, taskPanel, ui, autosave, reload };
}

describe('UI runtime event lifecycle', () => {
  it('flushes autosave and exposes reload recovery after renderer device loss', () => {
    const f = fixture();
    f.handlers.get('renderer.device-lost')({ api: 'WebGPU', reason: 'unknown', message: 'device reset' });
    expect(f.autosave.flush).toHaveBeenCalledOnce();
    expect(f.ui.setRuntimeStatus).toHaveBeenCalledWith('error', '渲染已中断 · 点击恢复');
    expect(f.ui.setRuntimeRecoveryAction).toHaveBeenCalledWith(f.reload, '渲染已中断 · 点击恢复');
    expect(f.taskPanel.log).toHaveBeenCalledWith(expect.stringContaining('场景已保存'), 'error');
    f.ui.setRuntimeRecoveryAction.mock.calls[0][0]();
    expect(f.reload).toHaveBeenCalledOnce();
  });

  it('still exposes recovery when emergency autosave fails', () => {
    const f = fixture();
    f.autosave.flush.mockImplementation(() => { throw new Error('quota'); });
    f.handlers.get('renderer.device-lost')({ api: 'WebGL', reason: null, message: 'context lost' });
    expect(f.ui.setRuntimeRecoveryAction).toHaveBeenCalledWith(f.reload, '渲染已中断 · 点击恢复');
    expect(f.taskPanel.log).toHaveBeenCalledWith('渲染中断后的自动保存失败：quota', 'error');
  });

  it('deselects an object that is removed outside the editor', () => {
    const f = fixture();
    f.handlers.get('object.removed')({ id: 'cup_01' });
    expect(f.editor.select).toHaveBeenCalledWith(null);
    expect(f.editor.selectedId).toBe(null);
    expect(f.taskPanel.log).toHaveBeenCalledWith('已删除：cup_01', 'tool');
  });

  it('does not disturb selection when another object is removed', () => {
    const f = fixture();
    f.handlers.get('object.removed')({ id: 'chair_01' });
    expect(f.editor.select).not.toHaveBeenCalled();
    expect(f.editor.selectedId).toBe('cup_01');
  });

  it('refreshes the selected inspector after semantic relations are rebuilt', () => {
    const f = fixture();
    f.handlers.get('sceneGraph.updated')({ edges: 12 });
    expect(f.inspector.render).toHaveBeenCalledWith('cup_01');
    expect(f.taskPanel.log).toHaveBeenCalledWith('场景图 · 12 条关系', 'graph');
  });

  it('does not refresh a stale selected id after it vanished from the store', () => {
    const f = fixture({ existing: [] });
    f.handlers.get('sceneGraph.updated')({ edges: 0 });
    expect(f.inspector.render).not.toHaveBeenCalled();
  });
});
