import { describe, expect, it, vi } from 'vitest';
import { WorldRuntime } from '../src/runtime/WorldRuntime.js';

describe('WorldRuntime articulation state restore',()=>{
  it('replays active partTargets before legacy verified parts',()=>{
    const record={manifest:{actions:['open','close']},state:{}};
    const runtime={
      store:{get:()=>record},
      interactions:{setArticulationAction:vi.fn()}
    };
    WorldRuntime.prototype.restoreObjectState.call(runtime,'cab',{
      parts:{door:'close'},
      partTargets:{door:'open'}
    });
    expect(runtime.interactions.setArticulationAction).toHaveBeenCalledTimes(1);
    expect(runtime.interactions.setArticulationAction).toHaveBeenCalledWith('cab','open',{partName:'door'});
    expect(record.state.parts.door).toBe('close');
    expect(record.state.partTargets.door).toBe('open');
  });

  it('keeps legacy state.parts scenes restorable when partTargets is absent',()=>{
    const record={manifest:{actions:['open','close']},state:{}};
    const runtime={store:{get:()=>record},interactions:{setArticulationAction:vi.fn()}};
    WorldRuntime.prototype.restoreObjectState.call(runtime,'cab',{parts:{door:'open'}});
    expect(runtime.interactions.setArticulationAction).toHaveBeenCalledWith('cab','open',{partName:'door'});
  });
});
