import { describe,expect,it } from 'vitest';
import { runCabinetCupCase } from '../../dev/acceptance/cabinetCup.mjs';
import { CABINET_CUP_TASK_WORLDS } from '../../application/tasks/CabinetCupTask.js';

describe('内置资产柜内取杯：真实 Runtime / Physics / Navigation / Interaction',()=>{
  for (const worldId of CABINET_CUP_TASK_WORLDS) {
    it(`${worldId} 三次重建后从静置柜内取杯到稳定桌面`,async()=>{
      const report=await runCabinetCupCase(worldId);
      expect(report,JSON.stringify(report)).toMatchObject({passed:true,attempts:[{initialInside:true,settledInside:true},{initialInside:true,settledInside:true},{initialInside:true,settledInside:true}]});
      for (const attempt of report.attempts) expect(attempt.stages.map((stage)=>stage.name)).toEqual(['build','settle-initial','preflight','open','pickup','place','verify']);
    },60000);
  }
  for (const fault of ['missing-target','blocked-door','occupied-surface','unreachable']) {
    it(`${fault} 可解释地停止并保留当前真实状态`,async()=>{
      const report=await runCabinetCupCase(fault === 'unreachable' ? 'magic-cabin' : 'monument-hall',{repeats:1,fault});
      expect(report,JSON.stringify(report)).toMatchObject({passed:true});
      expect(report.attempts[0].stages.some((stage)=>stage.name === 'verify')).toBe(false);
      if (fault === 'occupied-surface') expect(report.attempts[0].heldAfterFailure).toMatchObject({id:'agent_01'});
    },60000);
  }
});
