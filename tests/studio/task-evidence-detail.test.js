import {it,expect} from 'vitest';
import {taskEvidenceDetail} from '../../apps/studio/ui/task/TaskPanel.js';
it('distinguishes checked postconditions from full user intent in Studio',()=>{
  const text=taskEvidenceDetail({schema:'agentscape.task-evidence',schemaVersion:1,coverage:'agent-selected-postconditions',
    snapshot:{frame:12,tick:8},dimensions:{structure:{status:'verified'},behavior:{status:'not-required'},visual:{status:'pending'}},persistence:{status:'verified'}});
  expect(text).toContain('非全部需求证明');expect(text).toContain('行为：不要求');expect(text).toContain('视觉：待评价');
  expect(text).toContain('采样帧 12 / Tick 8');
  expect(taskEvidenceDetail(null)).toBe('');
});
