import {describe, it, expect, vi} from 'vitest';
import {ScenarioController} from '../../apps/observatory/app/ScenarioController.js';

function fixture() {
  const scenes = new Map([['a',{id:'a',title:'A'}],['b',{id:'b',title:'B'}]]);
  const lab={load:vi.fn(),invokeTool:vi.fn(),toolDefinitions:()=>[],resourceWorkbench:()=>null};
  const shell={renderScenarios:vi.fn(),setBusy:vi.fn(),configureToolWorkbench:vi.fn(),configureResourceWorkbench:vi.fn()};
  const app={lab,shell,activeLabId:'test',activeScenarioId:null,activationVersion:1,scenarioSelectionVersion:0,scenarioLoadPromise:Promise.resolve(),scenarios:{get:id=>scenes.get(id),list:()=>[...scenes.values()]},updateUrl:vi.fn()};
  app.selectScenario=id=>new ScenarioController(app).selectScenario(id);
  app.invokeTool=(name,args)=>new ScenarioController(app).invokeTool(name,args);
  return {app,lab,shell,controller:new ScenarioController(app)};
}

describe('ScenarioController concurrency',()=>{
  it('only publishes the latest rapidly selected scenario',async()=>{
    let release;
    const gate=new Promise(resolve=>{release=resolve;});
    const {app,lab,shell,controller}=fixture();
    lab.load.mockImplementation(()=>gate);
    const first=controller.selectScenario('a');
    await Promise.resolve();
    const second=controller.selectScenario('b');
    release();
    expect(await first).toBeNull();
    expect((await second).id).toBe('b');
    expect(shell.configureToolWorkbench).toHaveBeenCalledTimes(1);
    expect(app.activeScenarioId).toBe('b');
  });
  it('rejects a queued tool call when a new Lab activation begins',async()=>{
    const {app,lab,controller}=fixture();
    app.scenarioLoadPromise=new Promise(resolve=>{app.release=resolve;});
    const call=controller.invokeTool('getBounds',{});
    app.activationVersion++;
    app.release();
    await expect(call).rejects.toMatchObject({code:'SCENARIO_CHANGED'});
    expect(lab.invokeTool).not.toHaveBeenCalled();
  });
  it('does not clear busy state or publish panels after Lab activation changes',async()=>{
    let release;
    const {app,lab,shell,controller}=fixture();
    lab.load.mockImplementation(()=>new Promise(resolve=>{release=resolve;}));
    const pending=controller.selectScenario('a');
    await vi.waitFor(()=>expect(lab.load).toHaveBeenCalledOnce());
    app.activationVersion++;
    release();
    expect(await pending).toBeNull();
    expect(shell.configureToolWorkbench).not.toHaveBeenCalled();
    expect(shell.setBusy).toHaveBeenCalledTimes(1);
  });
});
