import { describe, expect, it, vi } from 'vitest';
import { TaskPanel } from '../../apps/studio/ui/task/TaskPanel.js';
import { createAgentJourney } from '../../apps/studio/agent/AgentJourney.js';

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
    expect(panel.log).toHaveBeenCalledWith('执行记录错误：runs panel unavailable', 'error');
  });

  it('ignores tool events from other Studio execution sources while an Agent journey is active', () => {
    const panel = Object.create(TaskPanel.prototype);
    panel.busy = true;
    panel.journeySource = 'agent';
    panel.journey = createAgentJourney('拿起杯子', '拿起杯子');
    panel.renderJourney = vi.fn();
    panel.observeAgentTool({ name:'spawnAsset', args:{assetId:'chair'}, source:'studio-ui' });
    expect(panel.journey.actions).toHaveLength(0);
    panel.observeAgentTool({ name:'approachAndPickup', args:{targetId:'cup_01'}, source:'agent' });
    expect(panel.journey.actions).toHaveLength(1);
    expect(panel.renderJourney).toHaveBeenCalledOnce();
  });
});
