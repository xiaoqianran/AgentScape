import { describe, expect, it, vi } from 'vitest';
import { CommandHistory } from '../../modules/world/runtime/CommandHistory.js';

describe('CommandHistory', () => {
  it('records, undoes and redoes state snapshots', async () => {
    let state = { value: 2 };
    const apply = vi.fn(async (next) => { state = structuredClone(next); });
    const history = new CommandHistory({ apply });
    history.begin('move', { value: 1 });
    history.commit({ value: 2 }, { source: 'agent' });
    expect(history.canUndo()).toBe(true);
    await history.undo();
    expect(state.value).toBe(1);
    expect(history.canRedo()).toBe(true);
    await history.redo();
    expect(state.value).toBe(2);
  });

  it('does not record a no-op', () => {
    const history = new CommandHistory({ apply: async () => {} });
    history.begin('noop', { value: 1 });
    expect(history.commit({ value: 1 })).toBe(false);
    expect(history.canUndo()).toBe(false);
  });

  it('clears redo history after a new command', async () => {
    const history = new CommandHistory({ apply: async () => {} });
    history.begin('a', { v: 0 }); history.commit({ v: 1 });
    await history.undo();
    history.begin('b', { v: 0 }); history.commit({ v: 2 });
    expect(history.canRedo()).toBe(false);
  });

  it('keeps the command when applying an undo fails', async () => {
    const history = new CommandHistory({ apply: async () => { throw new Error('restore failed'); } });
    history.begin('move', { value: 1 });
    history.commit({ value: 2 });
    expect(history.status()).toMatchObject({ undo: 1, redo: 0 });

    await expect(history.undo()).rejects.toThrow('restore failed');

    expect(history.status()).toMatchObject({ undo: 1, redo: 0 });
  });

  it('refuses to re-enter while a restore is still applying', async () => {
    let release = null;
    const history = new CommandHistory({ apply: () => new Promise((resolve) => { release = resolve; }) });
    history.begin('move', { value: 1 });
    history.commit({ value: 2 });

    const pending = history.undo();
    expect(await history.undo()).toBe(false);
    release();
    await expect(pending).resolves.toMatchObject({ label: 'move' });
    expect(history.status()).toMatchObject({ undo: 0, redo: 1 });
  });
});
