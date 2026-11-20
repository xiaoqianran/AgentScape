import {it,expect} from 'vitest';
import {TaskPanel} from '../../apps/studio/ui/task/TaskPanel.js';

const tick=()=>new Promise(resolve=>setTimeout(resolve,0));

it('respects a user-selected Legacy backend when Pi availability arrives late',async()=>{
  let release;
  const available=new Promise(resolve=>release=resolve);
  const panel=new TaskPanel();
  panel.attachAgent({agent:null,gateway:{isConfigured:()=>false}});
  panel.attachExternalBackends({availability:()=>available});
  await panel.selectBackend('legacy');
  release({pi:true,dsh:false});
  await tick();
  expect(panel.snapshot().backend).toBe('legacy');
  expect(panel.snapshot().available).toBe(false);
  panel.dispose();
});

it('ignores an obsolete automatic Pi selection that resolves after manual Legacy choice',async()=>{
  let finishPi,requests=0;
  const panel=new TaskPanel();
  panel.attachAgent({agent:null,gateway:{isConfigured:()=>false}});
  panel.attachExternalBackends({availability:()=>{
    requests++;
    return requests===1 ? Promise.resolve({pi:true,dsh:false})
      : new Promise(resolve=>finishPi=resolve);
  }});
  await tick();
  expect(typeof finishPi).toBe('function');
  await panel.selectBackend('legacy');
  finishPi({pi:true,dsh:false});
  await tick();
  expect(panel.snapshot().backend).toBe('legacy');
  expect(panel.snapshot().available).toBe(false);
  panel.dispose();
});

it('prefers Pi automatically before any explicit user choice',async()=>{
  const panel=new TaskPanel();
  panel.attachAgent({agent:null,gateway:{isConfigured:()=>false}});
  panel.attachExternalBackends({availability:async()=>({pi:true,dsh:false})});
  await tick();
  expect(panel.snapshot().backend).toBe('pi');
  expect(panel.snapshot().available).toBe(true);
  panel.dispose();
});
