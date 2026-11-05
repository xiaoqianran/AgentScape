import {it,expect,vi} from 'vitest';
import {EditorCommandQueue} from '../../apps/studio/editor/EditorCommandQueue.js';
function harness(){let release;const gate=new Promise(resolve=>{release=resolve;});const scene={inspect:()=>({source:'asset'}),interact:vi.fn(()=>({id:'job'})),waitJob:vi.fn(()=>gate)};return {scene,release,queue:new EditorCommandQueue({tools:{call:vi.fn()},scene})};}
it('deduplicates before either surface receives its first render and shares the operation',async()=>{
 const {scene,release,queue}=harness();const input={actor:'agent',target:'cup',action:'pickup'};
 const first=queue.executeAffordance(input),second=queue.executeAffordance({...input});
 expect(first).toBe(second);expect(queue.isActionPending('cup')).toBe(true);
 await Promise.resolve();await Promise.resolve();expect(scene.interact).toHaveBeenCalledTimes(1);
 release({status:'succeeded',result:{verification:{status:'verified'}}});await first;
 expect(queue.actionSnapshot('agent','cup')).toMatchObject({operationId:1,targetId:'cup',status:'succeeded'});
 expect(queue.actionSnapshot('agent','table')).toBeNull();expect(queue.actionSnapshot('another-agent','cup')).toBeNull();
 expect(queue.isActionPending('cup')).toBe(false);
});
it('does not queue a conflicting second action and retains verification failures only on the target',async()=>{
 const {queue,release}=harness();const input={actor:'agent',target:'cup',action:'pickup'};
 const first=queue.executeAffordance(input);const failure=expect(first).rejects.toThrow('交互未验证');
 await expect(queue.executeAffordance({...input,action:'push'})).rejects.toThrow('已有动作');
 release({status:'failed',result:{verification:{status:'failed'},value:{reason:'blocked'}}});await failure;
 expect(queue.actionSnapshot('agent','cup')).toMatchObject({status:'failed'});
 expect(queue.actionSnapshot('agent','table')).toBeNull();expect(queue.isActionPending('cup')).toBe(false);
});

it('isolates completion from a previous world even when the new world reuses target ids',async()=>{
 const {queue,release}=harness();const old=queue.executeAffordance({actor:'agent',target:'cup',action:'pickup'});const rejected=expect(old).rejects.toThrow('世界已切换');
 await Promise.resolve();await Promise.resolve();queue.actions.reset();
 release({status:'succeeded',result:{verification:{status:'verified'}}});await rejected;
 expect(queue.actionSnapshot('agent','cup')).toBeNull();expect(queue.isActionPending('cup')).toBe(false);
});
