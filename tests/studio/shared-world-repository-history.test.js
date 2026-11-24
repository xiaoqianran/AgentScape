import {describe,it,expect,vi} from 'vitest';
import {SharedWorldRepository} from '../../apps/studio/code-project/SharedWorldRepository.js';
import {compareCodeVersions,forkCodeVersion} from '../../apps/studio/code-project/WorldVersionSummary.js';
import {AuthoringWorldStore} from '../../apps/studio/persistence/AuthoringWorldStore.js';
import {StudioCodeProjects} from '../../apps/studio/code-project/StudioCodeProjects.js';

const id='world_'+'a'.repeat(32);
const project={schema:'agentscape.code-project',schemaVersion:1,id,name:'Shared tower',resources:{},
  source:'export function createProject(){}',
  runtime:{snapshot:{metadata:{environment:'code-project:'+id},objects:[{id:'tower',position:[0,0,0]}]}},
  edits:{schema:'agentscape.native-edits',schemaVersion:1,overrides:{tower:{position:[2,0,0]}}}};
const record=(version,content=project)=>({kind:'code-project',id,version,content});

describe('shared code history inspection and safe reopening',()=>{
  it('compares content independent of object key order and creates a separate draft without changing the original',async()=>{
    const changed=structuredClone(project);
    changed.source+='\n// Changed';
    changed.edits.overrides.tower.position=[8,0,0];
    changed.resources={'new.txt':{mime:'text/plain',base64:'eA=='}};
    changed.runtime.snapshot.objects[0]={position:[0,0,0],id:'tower'};
    const result=await compareCodeVersions(record(1),record(2,changed));
    expect(result).toMatchObject({fromVersion:1,toVersion:2,
      files:{modified:{total:1,items:['main.js']}},
      resources:{added:{total:1,items:['new.txt']}},
      nativeEdits:{modified:{total:1,items:['tower']}},
      managedObjects:{modified:{total:0,items:[]}},runtimeChanged:false});
    const store=new AuthoringWorldStore({indexedDBImpl:null});
    await store.save({id,name:project.name,document:{project:changed,revision:4}});
    const fork=await forkCodeVersion(record(1),store);
    expect(fork.id).not.toBe(id);
    const saved=await store.load(fork.id);
    expect(saved.document.requiresExplicitRun).toBe(true);
    expect(saved.document.project.runtime.snapshot.metadata.environment).toBe('code-project:'+fork.id);
    expect(saved.document.project.edits).toEqual(project.edits);
    expect((await store.load(id)).document.project).toEqual(changed);
  });
  it('retains explicit-run provenance after shared import, source edit, and controller reload',async()=>{
    const store=new AuthoringWorldStore({indexedDBImpl:null});
    const repository={openCode:vi.fn(async()=>record(1)),remember:vi.fn(),versionOf:()=>null};
    const controller=new StudioCodeProjects({store,repository});
    await controller.importShared(id);
    expect(controller.snapshot().requiresExplicitRun).toBe(true);
    await controller.write({expectedRevision:controller.revision,name:'Edited'});
    const reopened=new StudioCodeProjects({store,repository});
    await reopened.load(id);
    expect(reopened.snapshot().requiresExplicitRun).toBe(true);
    expect(reopened.snapshot().project.name).toBe('Edited');
    expect(reopened.snapshot().active).toBe(false);
    await reopened.write({create:true});
    expect(reopened.snapshot().requiresExplicitRun).toBe(false);
  });
});

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
