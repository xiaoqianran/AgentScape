import {describe,it,expect,vi} from 'vitest';
import {SharedWorldRepository} from '../../apps/studio/code-project/SharedWorldRepository.js';

describe('shared rollback does not claim stale local draft ownership',()=>{
  it('does not advance the browser local optimistic revision after rollback',async()=>{
    const map=new Map();
    const storage={getItem:key=>map.get(key)||null,setItem:(key,value)=>map.set(key,value)};
    const fetchImpl=vi.fn(async(url,options)=>({
      ok:true,status:200,json:async()=>({id:'world_local',version:4,restoredFromVersion:1})
    }));
    const repository=new SharedWorldRepository({fetchImpl,storage});
    repository.remember('world_local',3);
    const recovered=await repository.rollback({
      id:'world_local',targetVersion:1,baseVersion:3,token:'a-test-secret'
    });
    expect(recovered.version).toBe(4);
    // A local draft still based on v3 must not silently be promoted to v4.
    expect(repository.versionOf('world_local')).toBe(3);
    const second=new SharedWorldRepository({fetchImpl,storage});
    expect(second.versionOf('world_local')).toBe(3);
    expect(fetchImpl).toHaveBeenCalledWith('/api/studio/worlds/world_local/rollback',
      expect.objectContaining({method:'POST',body:JSON.stringify({targetVersion:1,baseVersion:3})}));
  });
});
