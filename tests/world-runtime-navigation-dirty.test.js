import { expect, it, vi } from 'vitest';
import { WorldRuntime } from '../world/runtime/WorldRuntime.js';

it('invalidates static navigation when the editor commits a fixed-object transform', () => {
  const record={manifest:{physics:{body:'fixed'}}};
  const runtime={
    history:{suspended:false,commit:vi.fn()},
    sceneGraph:{changed:vi.fn()},
    snapshot:vi.fn(()=>({})),
    store:{has:vi.fn(()=>true),get:vi.fn(()=>record)},
    navigation:{invalidateIfStatic:vi.fn()}
  };
  WorldRuntime.prototype.commitMutation.call(runtime,{source:'editor',id:'wall_1',mode:'translate'});
  expect(runtime.navigation.invalidateIfStatic).toHaveBeenCalledWith(record,'editor.transform');
  expect(runtime.history.commit).toHaveBeenCalledOnce();
});
