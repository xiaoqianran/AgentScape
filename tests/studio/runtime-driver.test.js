import { describe, expect, it, vi } from 'vitest';
import { RuntimeDriver } from '../../apps/studio/runtime/RuntimeDriver.js';

const createWorld = () => {
  const listeners = new Map();
  return {
    simulation:{
      reset:vi.fn(),
      play:vi.fn(),
      pause:vi.fn(),
      pump:vi.fn()
    },
    rendering:{
      update:vi.fn(),
      render:vi.fn(),
      resize:vi.fn()
    },
    events:{
      on:vi.fn((type,handler)=>{ listeners.set(type,handler); return () => listeners.delete(type); })
    },
    listeners
  };
};

describe('RuntimeDriver', () => {
  it('owns RAF, resize, simulation pumping and presentation frames outside WorldRuntime', () => {
    const world=createWorld();
    const callbacks=[];
    const requestFrame=vi.fn((callback)=>{ callbacks.push(callback); return callbacks.length; });
    const cancelFrame=vi.fn();
    const windowTarget={addEventListener:vi.fn(),removeEventListener:vi.fn()};
    const syncInput=vi.fn();
    const driver=new RuntimeDriver(world,{requestFrame,cancelFrame,windowTarget,now:()=>99,syncInput}).start();

    expect(world.simulation.reset).not.toHaveBeenCalled();
    expect(world.simulation.play).toHaveBeenCalledOnce();
    expect(world.rendering.resize).toHaveBeenCalledOnce();
    expect(windowTarget.addEventListener).toHaveBeenCalledWith('resize',driver.onResize);
    expect(requestFrame).toHaveBeenCalledOnce();

    callbacks[0](1234.5);

    expect(syncInput).toHaveBeenCalledWith(1234.5);
    expect(world.simulation.pump).toHaveBeenCalledWith(1234.5);
    expect(syncInput.mock.invocationCallOrder[0]).toBeLessThan(world.simulation.pump.mock.invocationCallOrder[0]);
    expect(world.rendering.update).toHaveBeenCalledOnce();
    expect(world.rendering.render).toHaveBeenCalledWith(1234.5);
    expect(requestFrame).toHaveBeenCalledTimes(2);

    driver.stop();
    expect(cancelFrame).toHaveBeenCalledWith(2);
    expect(world.simulation.pause).toHaveBeenCalledOnce();
    expect(windowTarget.removeEventListener).toHaveBeenCalledWith('resize',driver.onResize);
  });

  it('drives World Authoring animation with seconds-based delta and elapsed time', () => {
    const world=createWorld();
    const authoring={update:vi.fn()};
    const callbacks=[];
    const requestFrame=vi.fn((callback)=>{ callbacks.push(callback); return callbacks.length; });
    const driver=new RuntimeDriver(world,{
      requestFrame,
      cancelFrame:vi.fn(),
      windowTarget:null,
      authoring
    }).start();

    callbacks[0](1000);
    callbacks[1](1250);
    callbacks[2](1750);

    expect(authoring.update.mock.calls).toEqual([
      [0,0],
      [0.25,0.25],
      [0.5,0.75]
    ]);
    expect(world.simulation.pump.mock.invocationCallOrder[0]).toBeLessThan(authoring.update.mock.invocationCallOrder[0]);
    expect(authoring.update.mock.invocationCallOrder[0]).toBeLessThan(world.rendering.update.mock.invocationCallOrder[0]);

    driver.stop();
  });

  it('keeps simulation running while other product pages hide the 3D canvas', () => {
    const world=createWorld();
    const callbacks=[];
    let visible=false;
    const driver=new RuntimeDriver(world,{
      requestFrame:(callback)=>{ callbacks.push(callback); return callbacks.length; },
      cancelFrame:vi.fn(),
      windowTarget:null,
      shouldRender:()=>visible
    }).start();

    callbacks[0](1000);
    expect(world.simulation.pump).toHaveBeenCalledWith(1000);
    expect(world.rendering.update).not.toHaveBeenCalled();
    expect(world.rendering.render).not.toHaveBeenCalled();

    visible=true;
    callbacks[1](1016);
    expect(world.simulation.pump).toHaveBeenCalledWith(1016);
    expect(world.rendering.update).toHaveBeenCalledOnce();
    expect(world.rendering.render).toHaveBeenCalledWith(1016);

    driver.stop();
  });

  it('stops the browser loop when the renderer reports device loss', () => {
    const world=createWorld();
    const requestFrame=vi.fn(()=>17);
    const cancelFrame=vi.fn();
    const driver=new RuntimeDriver(world,{requestFrame,cancelFrame,windowTarget:null}).start();

    world.listeners.get('renderer.device-lost')?.({type:'renderer.device-lost'});

    expect(driver.running).toBe(false);
    expect(cancelFrame).toHaveBeenCalledWith(17);
    expect(world.simulation.pause).toHaveBeenCalledOnce();
  });

  it('stops and reports a frame failure instead of leaving a stalled running driver', () => {
    const world=createWorld();
    const callbacks=[];
    const cancelFrame=vi.fn();
    const emitted=[];
    world.events.emit=vi.fn((type,payload)=>emitted.push({type,...payload}));
    world.rendering.render.mockImplementationOnce(()=>{throw new Error('GPU frame failed');});
    const driver=new RuntimeDriver(world,{
      requestFrame:(callback)=>{callbacks.push(callback);return callbacks.length;},
      cancelFrame,
      windowTarget:null
    }).start();

    callbacks[0](1000);

    expect(driver.running).toBe(false);
    expect(driver.frameId).toBe(null);
    expect(world.simulation.pause).toHaveBeenCalledOnce();
    expect(callbacks).toHaveLength(1);
    expect(emitted).toEqual([{type:'RuntimeFrameError',message:'GPU frame failed'}]);
    expect(driver.stop()).toBe(false);
  });
  it('is idempotent across repeated start and stop calls', () => {
    const world=createWorld();
    const requestFrame=vi.fn(()=>3);
    const cancelFrame=vi.fn();
    const driver=new RuntimeDriver(world,{requestFrame,cancelFrame,windowTarget:null});

    driver.start();
    driver.start();
    expect(requestFrame).toHaveBeenCalledOnce();
    expect(world.simulation.reset).not.toHaveBeenCalled();

    expect(driver.stop()).toBe(true);
    expect(driver.stop()).toBe(false);
    expect(world.simulation.pause).toHaveBeenCalledOnce();
  });
});
