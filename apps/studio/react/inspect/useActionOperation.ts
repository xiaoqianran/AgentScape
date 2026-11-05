import { useSyncExternalStore } from 'react';
import type { EditorCommandsLike } from './InspectorTypes';
export function useActionOperation(commands:EditorCommandsLike,actor:string|null,target:string) {
  const subscribe=(listener:()=>void)=>commands.subscribeActions?.(listener) || (()=>{});
  const operation=useSyncExternalStore(subscribe,()=>commands.actionSnapshot?.(actor,target) ?? null,()=>null);
  const running=useSyncExternalStore(subscribe,()=>commands.isActionPending?.(target) ?? false,()=>false);
  return {running,feedback:operation?.feedback || '',error:operation?.error || ''};
}
