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
      render:vi.fn()
    },
    resize:vi.fn(),
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
    expect(world.resize).toHaveBeenCalledOnce();
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
