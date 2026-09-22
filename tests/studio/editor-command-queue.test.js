import { describe, expect, it, vi } from 'vitest';
import { EditorCommandQueue } from '../../apps/studio/editor/EditorCommandQueue.js';

describe('EditorCommandQueue',()=>{
  it('serializes editor mutations instead of overlapping writes',async()=>{
    const order=[];
    let releaseFirst;
    const firstGate=new Promise(resolve=>{releaseFirst=resolve;});
    const tools={
      call:vi.fn(async(name,args)=>{
        order.push('start:' + args.id);
        if(args.id === 'first') await firstGate;
        order.push('end:' + args.id);
        return {name,args};
      })
    };
    const queue=new EditorCommandQueue({tools});

    const first=queue.runtimeAction('open','first');
    const second=queue.runtimeAction('open','second');
    await Promise.resolve();
    expect(order).toEqual(['start:first']);

    releaseFirst();
    await Promise.all([first,second]);
    expect(order).toEqual(['start:first','end:first','start:second','end:second']);
    expect(queue.snapshot()).toMatchObject({pending:0,revision:2,lastError:null});
  });

  it('routes Authoring edits through AuthoringDocument.patch with revision labels',async()=>{
    const patch=vi.fn(()=>({version:1}));
    const onCommitted=vi.fn();
    const queue=new EditorCommandQueue({
      tools:{call:vi.fn()},
      authoring:{patch},
      onCommitted
    });

    await queue.renameAuthoringNode('wall_01','North Wall');
    await queue.transformAuthoringNode('wall_01',{position:[1,2,3],scale:[2,2,2]});

    expect(patch).toHaveBeenNthCalledWith(1,{
      update:[{id:'wall_01',name:'North Wall'}]
    },{label:'Rename wall_01'});
    expect(patch).toHaveBeenNthCalledWith(2,{
      update:[{
        id:'wall_01',
        components:{
          transform:{
            type:'Transform',
            properties:{position:[1,2,3],scale:[2,2,2]}
          }
        }
      }]
    },{label:'Transform wall_01'});
    expect(onCommitted).toHaveBeenCalledTimes(2);
  });

  it('preserves queue health after a failed mutation',async()=>{
    const tools={
      call:vi.fn()
        .mockRejectedValueOnce(new Error('blocked'))
        .mockResolvedValueOnce({ok:true})
    };
    const queue=new EditorCommandQueue({tools});

    await expect(queue.runtimeAction('open','door_01')).rejects.toThrow('blocked');
    await expect(queue.runtimeAction('open','door_02')).resolves.toEqual({ok:true});
    expect(queue.snapshot()).toMatchObject({pending:0,revision:1,lastError:null});
  });
});
