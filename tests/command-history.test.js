import { describe, expect, it, vi } from 'vitest';
import { CommandHistory } from '../src/history/CommandHistory.js';

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
});
