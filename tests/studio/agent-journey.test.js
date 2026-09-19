import { describe, expect, it } from 'vitest';
import {
  actionLabel,
  createAgentJourney,
  addAgentTool,
  applyAgentSequence,
  finalizeAgentJourney,
  journeyRunDetail
} from '../../apps/studio/agent/AgentJourney.js';

describe('AgentJourney presentation model', () => {
  it('turns tool calls into user-facing actions and verified world changes', () => {
    let journey = createAgentJourney('拿起杯子', '拿起杯子');
    journey = addAgentTool(journey, {
      name:'approachAndPickup',
      args:{ actorId:'agent_01', targetId:'cup_01' }
    });
    expect(journey.actions[0].label).toBe('拿起 cup_01');
    expect(journey.actions[0].state).toBe('running');

    journey = applyAgentSequence(journey, {
      tool:'approachAndPickup',
      args:{ actorId:'agent_01', targetId:'cup_01' },
      executed:true,
      mutates:true,
      outcome:{ state:'verified', verified:true }
    });
    expect(journey.actions[0].state).toBe('success');
    expect(journey.changes).toEqual([
      expect.objectContaining({ label:'拿起 cup_01', state:'success', detail:'已验证' })
    ]);
  });

  it('rebuilds the final journey from authoritative execution data', () => {
    const journey = createAgentJourney('打开柜门', '打开柜门');
    const final = finalizeAgentJourney(journey, {
      status:'success',
      result:{
        message:'柜门已经打开。',
        execution:[
          {
            tool:'approachAndInteract',
            args:{ actorId:'agent_01', targetId:'cabinet_01', action:'open' },
            executed:true,
            mutates:true,
            outcome:{ state:'verified', verified:true }
          }
        ]
      }
    });
    expect(final.state).toBe('success');
    expect(final.actions[0]).toEqual(expect.objectContaining({ label:'打开 cabinet_01', state:'success' }));
    expect(final.changes[0]).toEqual(expect.objectContaining({ detail:'已验证' }));
    expect(final.result).toEqual(expect.objectContaining({ label:'成功', detail:'柜门已经打开。' }));
    expect(journeyRunDetail(final)).toBe('1 个动作 · 1 个世界变化 · 成功');
  });

  it('keeps planning-only calls out of world changes', () => {
    const journey = createAgentJourney('建立咖啡角', '建立咖啡角');
    const final = finalizeAgentJourney(journey, {
      status:'partial',
      result:{
        execution:[
          {
            tool:'listObjects',
            args:{},
            executed:true,
            mutates:false,
            outcome:{ state:'accepted', verified:null }
          },
          {
            tool:'spawnAsset',
            args:{ assetId:'cup', instanceId:'cup_02' },
            executed:false,
            mutates:true,
            outcome:{ state:'skipped', verified:false }
          }
        ]
      }
    });
    expect(final.actions).toHaveLength(2);
    expect(final.changes).toHaveLength(0);
    expect(final.result.label).toBe('部分完成');
  });

  it('provides concise labels for common world actions', () => {
    expect(actionLabel('spawnAsset', { assetId:'table', instanceId:'table_02' })).toBe('放置 table · table_02');
    expect(actionLabel('runWorldPipeline', {})).toBe('应用新的世界方案');
  });

  it('uses successful deterministic runtime actions as verified changes when execution metadata is absent', () => {
    let journey = createAgentJourney('打开柜门', 'Runtime · 打开柜门');
    journey = addAgentTool(journey, {
      name:'approachAndInteract',
      args:{ actorId:'agent_01', targetId:'cabinet_01', action:'open' }
    });
    const final = finalizeAgentJourney(journey, { status:'success', detail:'Runtime 验收通过。' });
    expect(final.changes).toEqual([
      expect.objectContaining({ label:'打开 cabinet_01', state:'success', detail:'已验证' })
    ]);
  });
});
