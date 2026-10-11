import {describe,it,expect,vi} from 'vitest';
import {LabActivationController} from '../../apps/observatory/app/LabActivationController.js';

describe('LabActivationController',()=>{
  it('does not install a superseded asynchronously imported Lab',async()=>{
    let release;
    const gate = new Promise(resolve=>{release=resolve;});
    const app={activationVersion:0,scenarioSelectionVersion:0,scenarioLoadPromise:Promise.resolve(),
      labs:{load:()=>gate},shell:{setBusy:vi.fn(),configureToolWorkbench:vi.fn(),configureResourceWorkbench:vi.fn()}};
    const operation=new LabActivationController(app).activateLab('physics-studio');
    app.activationVersion++;
    release({labDefinition:{id:'physics-studio',create:()=>{throw Error('stale Lab instantiated');}}});
    await expect(operation).resolves.toBeUndefined();
    expect(app.activeLabId).toBeUndefined();
  });
  it('rejects invalid imported Lab definitions before mutating the runtime',async()=>{
    const app={activationVersion:0,scenarioSelectionVersion:0,scenarioLoadPromise:Promise.resolve(),
      labs:{load:async()=>({labDefinition:{id:'other'}})},
      shell:{setBusy:vi.fn(),configureToolWorkbench:vi.fn(),configureResourceWorkbench:vi.fn()}};
    await expect(new LabActivationController(app).activateLab('navigation')).rejects.toThrow('Invalid Observatory lab module');
    expect(app.activeLabId).toBeUndefined();
  });
});
