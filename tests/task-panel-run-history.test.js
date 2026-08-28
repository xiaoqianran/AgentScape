import { describe, expect, it, vi } from 'vitest';
import { TaskPanel } from '../src/ui/task/TaskPanel.js';

describe('TaskPanel run history isolation', () => {
  it('records run history without changing task execution semantics', () => {
    const panel = Object.create(TaskPanel.prototype);
    panel.onRun = vi.fn();
    panel.log = vi.fn();
    const run = { id: 'run_1', status: 'success' };
    panel.recordRun(run);
    expect(panel.onRun).toHaveBeenCalledWith(run);
    expect(panel.log).not.toHaveBeenCalled();
  });

  it('contains run history UI failures instead of surfacing them as task failures', () => {
    const panel = Object.create(TaskPanel.prototype);
    panel.onRun = vi.fn(() => { throw new Error('runs panel unavailable'); });
    panel.log = vi.fn();
    expect(() => panel.recordRun({ id: 'run_1', status: 'success' })).not.toThrow();
    expect(panel.log).toHaveBeenCalledWith('run history error: runs panel unavailable', 'error');
  });
});
