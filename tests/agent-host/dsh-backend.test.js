import {describe,it,expect} from 'vitest';
import {runDshAgent} from '../../apps/agent-host/DshAgentBackend.js';

describe('restricted DSH adapter',()=>{
  it('refuses to start without a reviewed profile patch',async()=>{
    await expect(runDshAgent({prompt:'Observe',configuration:{dshProvider:'deepseek-official',dshModel:'model'}}))
      .rejects.toMatchObject({code:'DSH_RESTRICTED_PROFILE_REQUIRED'});
  });
  it('starts official SDK shape, rejects tool approval, closes subprocess and does not claim scene verification',async()=>{
    const calls=[],events=[];
    const fake={
      client:{start:()=>calls.push('start'),onRequest:fn=>{calls.push('onRequest');fake.request=fn;}},
      run:async(text,opts)=>{
        calls.push('run:'+text);
        opts.onNotification({method:'tool/execution'});
        return {finalResponse:'Tree created',sessionId:'sid-1',finishReason:'stop'};
      },
      close:async()=>{calls.push('close');}
    };
    const result=await runDshAgent({prompt:'Tree',configuration:{dshPatch:'approved-profile.yml',dshProvider:'deepseek-official',dshModel:'model'},
      harnessFactory:()=>fake,emit:event=>events.push(event)});
    expect(await fake.request('approval/request')).toEqual({outcome:'rejected'});
    expect(result.taskStatus).toBe('incomplete');
    expect(result.sessionId).toBe('sid-1');
    expect(calls).toEqual(['start','onRequest','run:Tree','close']);
    expect(events).toEqual(expect.arrayContaining([{type:'run.started',backend:'dsh'}]));
  });
});
